/**
 * mainfold-agent — Messages 路由（单一消息持久化源）
 *
 * 职责：
 *   为对话消息提供单一的持久化源，替代当前的双写架构
 *   （前端 localStorage + 后端 sessions.json 全量覆盖）
 *
 * 设计：
 *   - 每个会话（session）独立存储消息文件到 data/messages/
 *   - 消息按时间戳追加，无全量覆盖风险
 *   - 支持 SSE 流式写入（chat.ts 可在流式响应时逐条追加）
 *   - 前端只读不写，消除数据不一致风险
 *
 * 文件结构：
 *   data/messages/{sessionId}.jsonl
 *   每行一条 JSON 消息记录
 *
 * 消息格式：
 *   {
 *     "role": "user" | "assistant" | "system" | "tool",
 *     "content": string,
 *     "timestamp": ISO string,
 *     "metadata"?: { ... }
 *   }
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── 配置 ──

const MESSAGES_DIR = path.join(
  process.env.WORKSPACE_ROOT || process.cwd(),
  'data',
  'messages',
);

function ensureDir(): void {
  if (!fs.existsSync(MESSAGES_DIR)) {
    fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  }
}

function messagesFilePath(sessionId: string): string {
  // 清理 sessionId 防止路径遍历
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(MESSAGES_DIR, `${safeId}.jsonl`);
}

// ── 消息结构 ──

export interface MessageRecord {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ── 内部读写 ──

/**
 * 追加一条消息到指定会话的文件
 * （原子写入：每条消息独占一行 JSON）
 */
export function appendMessage(sessionId: string, msg: MessageRecord): void {
  ensureDir();
  const filePath = messagesFilePath(sessionId);
  const line = JSON.stringify(msg) + '\n';
  fs.appendFileSync(filePath, line, 'utf-8');
}

/**
 * 读取指定会话的所有消息
 */
export function readMessages(sessionId: string): MessageRecord[] {
  const filePath = messagesFilePath(sessionId);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as MessageRecord);
}

/**
 * 读取指定会话的最新 N 条消息
 */
export function readRecentMessages(sessionId: string, count: number): MessageRecord[] {
  const all = readMessages(sessionId);
  return all.slice(-count);
}

/**
 * 获取所有有消息记录的会话 ID 列表
 */
export function listMessageSessions(): string[] {
  ensureDir();
  const files = fs.readdirSync(MESSAGES_DIR);
  return files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''));
}

// ── 请求验证 ──

const AppendMessageSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const ReadMessagesQuerySchema = z.object({
  sessionId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const DeleteMessagesSchema = z.object({
  sessionId: z.string().min(1),
  before: z.string().optional(), // ISO 时间戳，删除该时间戳之前的消息
});

// ── 路由 ──

export function createMessagesRouter(): Router {
  const router = Router();

  // POST /api/messages/append — 追加消息（供 chat.ts 或外部使用）
  router.post('/api/messages/append', (req: Request, res: Response) => {
    const parsed = AppendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { sessionId, role, content, metadata } = parsed.data;
    const msg: MessageRecord = {
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    appendMessage(sessionId, msg);

    res.status(201).json({ status: 'appended', timestamp: msg.timestamp });
  });

  // POST /api/messages/batch — 批量追加（原子写入多条）
  router.post('/api/messages/batch', (req: Request, res: Response) => {
    const parsed = z.object({
      sessionId: z.string().min(1),
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      })).min(1).max(500),
    }).safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { sessionId, messages } = parsed.data;
    const now = new Date().toISOString();

    for (const m of messages) {
      appendMessage(sessionId, {
        ...m,
        timestamp: now,
      });
    }

    res.status(201).json({ status: 'appended', count: messages.length });
  });

  // GET /api/messages — 读取消息（按 sessionId 查询）
  router.get('/api/messages', (req: Request, res: Response) => {
    const parsed = ReadMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { sessionId, limit, offset } = parsed.data;
    let messages = readMessages(sessionId);

    if (offset !== undefined) {
      messages = messages.slice(offset);
    }
    if (limit !== undefined) {
      messages = messages.slice(0, limit);
    }

    res.json({ sessionId, messages, count: messages.length });
  });

  // GET /api/messages/sessions — 获取所有有消息记录的会话
  router.get('/api/messages/sessions', (_req: Request, res: Response) => {
    const sessions = listMessageSessions();
    const sessionCounts: Record<string, number> = {};

    for (const sid of sessions) {
      sessionCounts[sid] = readMessages(sid).length;
    }

    res.json({ sessions, counts: sessionCounts });
  });

  // DELETE /api/messages — 删除消息
  router.delete('/api/messages', (req: Request, res: Response) => {
    const parsed = DeleteMessagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { sessionId, before } = parsed.data;
    const filePath = messagesFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (before) {
      // 删除指定时间戳之前的消息
      const messages = readMessages(sessionId);
      const remaining = messages.filter((m) => m.timestamp >= before);

      if (remaining.length === messages.length) {
        res.json({ status: 'noop', deleted: 0, remaining: remaining.length });
        return;
      }

      // 重写文件
      const lines = remaining.map((m) => JSON.stringify(m) + '\n').join('');
      fs.writeFileSync(filePath, lines, 'utf-8');

      res.json({
        status: 'deleted',
        deleted: messages.length - remaining.length,
        remaining: remaining.length,
      });
    } else {
      // 删除整个会话文件
      fs.unlinkSync(filePath);
      res.json({ status: 'deleted', sessionId, deleted: 'all' });
    }
  });

  // GET /api/messages/stats — 消息统计（WorkBuddy 监控用）
  router.get('/api/messages/stats', (_req: Request, res: Response) => {
    const sessions = listMessageSessions();
    let totalMessages = 0;
    let totalSize = 0;

    for (const sid of sessions) {
      const filePath = messagesFilePath(sid);
      totalMessages += readMessages(sid).length;
      try {
        totalSize += fs.statSync(filePath).size;
      } catch { /* skip missing */ }
    }

    res.json({
      sessionCount: sessions.length,
      totalMessages,
      totalSizeBytes: totalSize,
      totalSizeKB: Math.round(totalSize / 1024),
      storagePath: MESSAGES_DIR,
    });
  });

  return router;
}
