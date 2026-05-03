/**
 * 会话持久化路由
 * 
 * 解决 localStorage 重启丢失问题：
 * - GET  /api/sessions          → 加载所有会话
 * - POST /api/sessions          → 保存所有会话（全量覆盖）
 * - GET  /api/sessions/:id      → 加载单个会话
 * - DELETE /api/sessions/:id    → 删除单个会话
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const SESSIONS_FILE = path.join(
  process.env.WORKSPACE_ROOT || process.cwd(),
  'data',
  'sessions.json',
);

interface SessionData {
  id: string;
  title: string;
  model: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning_content?: string | null;
    timestamp: string;
    token_used?: number;
    senderModel?: string;
    images?: string[];
    source?: 'user' | 'workbuddy' | 'system';
    tool_call_depth?: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

function ensureDir() {
  const dir = path.dirname(SESSIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadAll(): SessionData[] {
  try {
    ensureDir();
    if (!fs.existsSync(SESSIONS_FILE)) return [];
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAll(sessions: SessionData[]): void {
  ensureDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

export function createSessionsRouter(): Router {
  const router = Router();

  // GET /api/sessions — 加载所有会话
  router.get('/api/sessions', (_req: Request, res: Response) => {
    const sessions = loadAll();
    res.json({ sessions });
  });

  // POST /api/sessions — 保存所有会话（全量覆盖）
  router.post('/api/sessions', (req: Request, res: Response) => {
    try {
      const { sessions } = req.body as { sessions: SessionData[] };
      if (!Array.isArray(sessions)) {
        res.status(400).json({ error: 'sessions must be an array' });
        return;
      }
      saveAll(sessions);
      res.json({ status: 'saved', count: sessions.length });
    } catch (err) {
      console.error('[sessions] Save error:', err);
      res.status(500).json({ error: 'Failed to save sessions' });
    }
  });

  // GET /api/sessions/:id — 加载单个会话
  router.get('/api/sessions/:id', (req: Request, res: Response) => {
    const sessions = loadAll();
    const session = sessions.find((s) => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  // DELETE /api/sessions/:id — 删除单个会话
  router.delete('/api/sessions/:id', (req: Request, res: Response) => {
    const sessions = loadAll();
    const filtered = sessions.filter((s) => s.id !== req.params.id);
    if (filtered.length === sessions.length) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    saveAll(filtered);
    res.json({ status: 'deleted', id: req.params.id });
  });

  return router;
}
