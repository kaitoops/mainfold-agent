/**
 * mainfold-agent — Inject 路由 (前端 M8 ChatPage 注入轮询)
 *
 * 运行逻辑提取自 Hermes ChatPage 的 injectPolling 机制：
 *   前端每3秒轮询 /api/inject/pending
 *   如果有待注入消息，展示给用户，确认后删除
 *
 * 设计：
 *   - injectQueue: 内存队列（进程内，不持久化）
 *   - 来源：外部系统（如 WorkBuddy）通过 POST 注入
 *   - 前端通过 GET 获取 + DELETE 确认消费
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

// ── 注入队列 ──

interface InjectMessage {
  id: string;
  content: string;
  source: string;       // 'workbuddy' | 'system' | 'manual'
  timestamp: string;
  priority: number;     // 0=低, 1=普通, 2=高
}

const injectQueue: InjectMessage[] = [];

// ── 请求验证 ──

const InjectRequestSchema = z.object({
  content: z.string().min(1),
  source: z.string().default('manual'),
  priority: z.number().int().min(0).max(2).default(1),
});

// ── 路由器 ──

export function createInjectRouter(): Router {
  const router = Router();

  // GET /api/inject/pending — 前端轮询获取待注入消息
  router.get('/api/inject/pending', (_req: Request, res: Response) => {
    // 按优先级排序（高优先级在前），同优先级按时间排序
    const sorted = [...injectQueue].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    res.json({
      pending: sorted,
      count: sorted.length,
    });
  });

  // POST /api/inject/pending — 外部系统注入消息
  router.post('/api/inject/pending', (req: Request, res: Response) => {
    const parsed = InjectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const msg: InjectMessage = {
      id: `inject_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: parsed.data.content,
      source: parsed.data.source,
      timestamp: new Date().toISOString(),
      priority: parsed.data.priority,
    };

    injectQueue.push(msg);
    console.log(`[inject] New message from ${msg.source}: ${msg.content.slice(0, 50)}...`);

    res.status(201).json({ id: msg.id, status: 'queued' });
  });

  // DELETE /api/inject/pending/:id — 前端确认消费消息
  router.delete('/api/inject/pending/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const idx = injectQueue.findIndex((m) => m.id === id);

    if (idx === -1) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    injectQueue.splice(idx, 1);
    res.json({ status: 'consumed', id });
  });

  return router;
}
