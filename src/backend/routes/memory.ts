/**
 * mainfold-agent — Memory 路由 (Phase E)
 *
 * 暴露 ColdMemory、WarmIndex、MemoryReviewer 的 API 端点。
 * 区别于 routes/memories.ts（WebUI MemoryPage 数据源）：
 *   memories.ts — 前端可视化记忆管理
 *   memory.ts   — 后端自动记忆系统监控+管理
 *
 * 端点清单：
 *   GET  /api/memory/stats          — 冷记忆统计
 *   GET  /api/memory/conversations  — 最近对话列表
 *   GET  /api/memory/operations     — 最近工具操作列表
 *   GET  /api/memory/warm           — 暖索引条目
 *   GET  /api/memory/warm/search    — 搜索暖索引
 *   GET  /api/memory/warm/tag/:tag  — 按标签过滤
 *   GET  /api/memory/warm/context   — 获取上下文摘要
 *   POST /api/memory/review         — 手动触发整理
 *   GET  /api/memory/reviewer       — 整理器状态
 */

import { Router, Request, Response } from 'express';
import { ColdMemory } from '../memory/cold-db.js';
import { WarmIndex } from '../memory/warm-index.js';
import { MemoryReviewer } from '../memory/memory-reviewer.js';

export function createMemoryRouter(deps: {
  coldMemory: ColdMemory;
  warmIndex: WarmIndex;
  reviewer: MemoryReviewer;
}): Router {
  const router = Router();
  const { coldMemory, warmIndex, reviewer } = deps;

  // ── GET /api/memory/stats ──

  router.get('/api/memory/stats', (_req: Request, res: Response) => {
    try {
      const coldStats = coldMemory.getStats();
      const warmStats = warmIndex.getStats();
      const reviewerStatus = reviewer.getStatus();

      res.json({
        cold: coldStats,
        warm: warmStats,
        reviewer: reviewerStatus,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/conversations ──

  router.get('/api/memory/conversations', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const query = req.query.q as string | undefined;

      const conversations = query
        ? coldMemory.searchConversations(query, limit)
        : coldMemory.queryConversations(limit, offset);

      res.json({ conversations, count: conversations.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/operations ──

  router.get('/api/memory/operations', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const query = req.query.q as string | undefined;

      const operations = query
        ? coldMemory.searchToolOperations(query, limit)
        : coldMemory.queryToolOperations(limit, offset);

      res.json({ operations, count: operations.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/warm ──

  router.get('/api/memory/warm', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const entries = warmIndex.getRecent(limit);
      res.json({ entries, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/warm/search?q= ──

  router.get('/api/memory/warm/search', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q) {
        res.status(400).json({ error: 'Provide ?q= search query' });
        return;
      }
      const entries = warmIndex.search(q);
      res.json({ query: q, entries, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/warm/tag/:tag ──

  router.get('/api/memory/warm/tag/:tag', (req: Request, res: Response) => {
    try {
      const entries = warmIndex.getByTag(req.params.tag);
      res.json({ tag: req.params.tag, entries, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/warm/context ──

  router.get('/api/memory/warm/context', (req: Request, res: Response) => {
    try {
      const maxChars = parseInt(req.query.max_chars as string) || 3000;
      const summary = warmIndex.getContextSummary(maxChars);
      res.json({ summary, length: summary.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/memory/review ──

  router.post('/api/memory/review', async (_req: Request, res: Response) => {
    try {
      const result = await reviewer.runReview();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/memory/reviewer ──

  router.get('/api/memory/reviewer', (_req: Request, res: Response) => {
    try {
      const status = reviewer.getStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
