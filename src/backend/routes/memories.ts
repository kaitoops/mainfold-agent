/**
 * mainfold-agent — Memories 路由 (前端 M9 MemoryPage 数据源)
 *
 * 旧项目状态：前端有 MemoryPage 但后端没有 /api/memories 端点，全靠 mockMemories
 * 新项目策略：基于 better-sqlite3 内存数据库提供真实记忆 CRUD
 *
 * 记忆来源：
 *   1. Chat 对话自动提取（session 关键信息摘要）
 *   2. 手动添加
 *   3. 外部注入（WorkBuddy 注入后标记为记忆）
 *
 * 类型：
 *   - mempalace: MemPalace 结构化记忆
 *   - amp: 联想记忆（锚点词关联）
 *   - builtin: 系统内置（用户偏好等）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ── 内存数据库（进程重启重置，Phase 2 迁移到持久化）──

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'mempalace',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    comprehension_rate REAL,
    anchor_words TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
`);

// ── 预置初始数据（替代 mock，这些是系统真实的内置记忆）──

const SEED_MEMORIES = [
  {
    id: 'builtin_001',
    type: 'builtin',
    title: '系统启动配置',
    content: 'mainfold-agent 已完成 Phase 1 身份注入 + Phase 2 WebUI 前端搭建',
    source: 'system',
    comprehension_rate: 1.0,
  },
  {
    id: 'builtin_002',
    type: 'builtin',
    title: '默认模型偏好',
    content: '日常使用 deepseek-v4-flash，深度推理使用 deepseek-reasoner',
    source: 'system',
    comprehension_rate: 1.0,
  },
];

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO memories (id, type, title, content, comprehension_rate, anchor_words, source, created_at, updated_at)
  VALUES (@id, @type, @title, @content, @comprehension_rate, @anchor_words, @source, @created_at, @updated_at)
`);

const now = new Date().toISOString();
for (const seed of SEED_MEMORIES) {
  insertStmt.run({
    ...seed,
    anchor_words: null,
    created_at: now,
    updated_at: now,
  });
}

// ── 请求验证 ──

const CreateMemorySchema = z.object({
  type: z.enum(['mempalace', 'amp', 'builtin']).default('mempalace'),
  title: z.string().min(1),
  content: z.string().min(1),
  source: z.string().default('manual'),
  anchor_words: z.array(z.string()).optional(),
});

const UpdateMemorySchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  comprehension_rate: z.number().min(0).max(1).optional(),
  anchor_words: z.array(z.string()).optional(),
});

const SearchSchema = z.object({
  q: z.string().min(1),
  type: z.enum(['mempalace', 'amp', 'builtin']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

// ── 路由器 ──

export function createMemoriesRouter(): Router {
  const router = Router();

  // GET /api/memories — 列表（支持按类型过滤）
  router.get('/api/memories', (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    let rows;
    let total;

    if (type && ['mempalace', 'amp', 'builtin'].includes(type)) {
      rows = db.prepare(
        'SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      ).all(type, limit, offset);
      total = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE type = ?').get(type) as any).count;
    } else {
      rows = db.prepare(
        'SELECT * FROM memories ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      ).all(limit, offset);
      total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;
    }

    // 解析 anchor_words JSON
    const memories = (rows as any[]).map((row) => ({
      ...row,
      anchor_words: row.anchor_words ? JSON.parse(row.anchor_words) : null,
    }));

    // 统计各类型数量
    const stats = db.prepare(
      'SELECT type, COUNT(*) as count FROM memories GROUP BY type'
    ).all() as any[];

    const counts: Record<string, number> = { mempalace: 0, amp: 0, builtin: 0 };
    for (const s of stats) {
      counts[s.type] = s.count;
    }

    res.json({
      memories,
      total,
      counts,
      limit,
      offset,
    });
  });

  // GET /api/memories/search — 搜索
  router.get('/api/memories/search', (req: Request, res: Response) => {
    const parsed = SearchSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid search params', details: parsed.error.issues });
      return;
    }

    const { q, type, limit } = parsed.data;
    const searchTerm = `%${q}%`;

    let rows;
    if (type) {
      rows = db.prepare(
        'SELECT * FROM memories WHERE type = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT ?'
      ).all(type, searchTerm, searchTerm, limit);
    } else {
      rows = db.prepare(
        'SELECT * FROM memories WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?'
      ).all(searchTerm, searchTerm, limit);
    }

    const memories = (rows as any[]).map((row) => ({
      ...row,
      anchor_words: row.anchor_words ? JSON.parse(row.anchor_words) : null,
    }));

    res.json({ memories, count: memories.length });
  });

  // GET /api/memories/:id — 单条
  router.get('/api/memories/:id', (req: Request, res: Response) => {
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as any;
    if (!row) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.json({
      ...row,
      anchor_words: row.anchor_words ? JSON.parse(row.anchor_words) : null,
    });
  });

  // POST /api/memories — 创建
  router.post('/api/memories', (req: Request, res: Response) => {
    const parsed = CreateMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const data = parsed.data;

    db.prepare(`
      INSERT INTO memories (id, type, title, content, comprehension_rate, anchor_words, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type,
      data.title,
      data.content,
      data.type === 'builtin' ? 1.0 : null,
      data.anchor_words ? JSON.stringify(data.anchor_words) : null,
      data.source,
      now,
      now,
    );

    res.status(201).json({ id, status: 'created' });
  });

  // PUT /api/memories/:id — 更新
  router.put('/api/memories/:id', (req: Request, res: Response) => {
    const parsed = UpdateMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    const data = parsed.data;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE memories SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        comprehension_rate = COALESCE(?, comprehension_rate),
        anchor_words = COALESCE(?, anchor_words),
        updated_at = ?
      WHERE id = ?
    `).run(
      data.title ?? null,
      data.content ?? null,
      data.comprehension_rate ?? null,
      data.anchor_words ? JSON.stringify(data.anchor_words) : null,
      now,
      req.params.id,
    );

    res.json({ id: req.params.id, status: 'updated' });
  });

  // DELETE /api/memories/:id — 删除
  router.delete('/api/memories/:id', (req: Request, res: Response) => {
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.json({ id: req.params.id, status: 'deleted' });
  });

  // GET /api/mempalace/scan — 层级扫描状态（真实计算）
  router.get('/api/mempalace/scan', (_req: Request, res: Response) => {
    const now = Date.now();
    const dayMs = 86400000;

    const layers = [
      { layer: 1, label: '最近7天', since: now - 7 * dayMs },
      { layer: 2, label: '最近30天', since: now - 30 * dayMs },
      { layer: 3, label: '最近90天', since: now - 90 * dayMs },
      { layer: 4, label: '90天以上', since: 0 },
    ];

    const total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;

    const scanResults = layers.map((l) => {
      const count = l.since > 0
        ? (db.prepare('SELECT COUNT(*) as count FROM memories WHERE created_at >= ?').get(new Date(l.since).toISOString()) as any).count
        : total;
      const rate = total > 0 ? Math.round((count / total) * 100) : 0;
      return { ...l, count, rate };
    });

    res.json({ layers: scanResults, total });
  });

  return router;
}
