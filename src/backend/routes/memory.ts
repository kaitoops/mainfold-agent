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
 *   POST /api/memory/warm/add       — 添加暖索引条目
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

  // ── POST /api/memory/warm/add ──

  router.post('/api/memory/warm/add', (req: Request, res: Response) => {
    try {
      const { type, title, summary, tags, source, importance } = req.body;

      if (!type || !title || !summary) {
        res.status(400).json({ error: 'Required: type, title, summary' });
        return;
      }

      const validTypes = [
        'conversation', 'tool_operation', 'technical_pattern', 'error_lesson', 'system_event',
        'friction_point', 'repair_evaluation', 'business_pattern', 'security_issue',
        'workflow_pattern', 'observation_metric'
      ];
      if (!validTypes.includes(type)) {
        res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
        return;
      }

      const id = warmIndex.add({
        type,
        title: String(title).slice(0, 100),
        summary: String(summary),
        tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
        source: String(source || 'api'),
        importance: typeof importance === 'number' ? Math.max(0, Math.min(1, importance)) : 0.5,
      });

      res.status(201).json({ id, status: 'added' });
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

  // ── 摩擦点记录 API（WorkBuddy 移植） ──

  // POST /api/memory/friction — 记录摩擦点
  router.post('/api/memory/friction', (req: Request, res: Response) => {
    try {
      const { dimension, severity, title, description, rootCause, impact, suggestion } = req.body;

      if (!dimension || !title || !description) {
        res.status(400).json({ error: 'Required: dimension, title, description' });
        return;
      }

      const validDimensions = [
        'memory_retrieval', 'rule_trigger', 'experience_reuse', 'daily_log_quality',
        'cross_file_collab', 'code_quality', 'api_consistency', 'repair_observation'
      ];
      if (!validDimensions.includes(dimension)) {
        res.status(400).json({ error: `Invalid dimension. Must be one of: ${validDimensions.join(', ')}` });
        return;
      }

      const validSeverities = ['low', 'medium', 'high', 'critical'];
      const severityLevel = validSeverities.includes(severity) ? severity : 'medium';

      const id = warmIndex.add({
        type: 'friction_point',
        title: String(title).slice(0, 100),
        summary: JSON.stringify({
          dimension,
          severity: severityLevel,
          description,
          rootCause: rootCause || '',
          impact: impact || '',
          suggestion: suggestion || '',
          status: 'observed',
        }),
        tags: ['friction_point', dimension, severityLevel],
        source: 'friction_api',
        importance: severityLevel === 'critical' ? 0.9 : severityLevel === 'high' ? 0.7 : severityLevel === 'medium' ? 0.5 : 0.3,
      });

      res.status(201).json({ id, status: 'recorded' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/memory/friction — 查询摩擦点
  router.get('/api/memory/friction', (req: Request, res: Response) => {
    try {
      const dimension = req.query.dimension as string | undefined;
      const severity = req.query.severity as string | undefined;

      let entries = warmIndex.getByType('friction_point');

      if (dimension) {
        entries = entries.filter(e => e.tags.includes(dimension));
      }
      if (severity) {
        entries = entries.filter(e => e.tags.includes(severity));
      }

      res.json({ entries, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── 修复评估 API（WorkBuddy 移植） ──

  // POST /api/memory/repair — 记录修复评估
  router.post('/api/memory/repair', (req: Request, res: Response) => {
    try {
      const { target, attempt, changes, verification, frictionPoints, lessonsLearned } = req.body;

      if (!target) {
        res.status(400).json({ error: 'Required: target' });
        return;
      }

      const id = warmIndex.add({
        type: 'repair_evaluation',
        title: `修复: ${String(target).slice(0, 80)}`,
        summary: JSON.stringify({
          target,
          attempt: attempt || { number: 1, firstTimeSuccess: false, deadCycles: 0, invalidReads: 0 },
          changes: changes || { filesModified: [], linesChanged: 0, tokenConsumed: 'unknown' },
          verification: verification || { problemReproduced: false, fixVerified: false, regression: false, userSatisfied: false },
          frictionPoints: frictionPoints || [],
          lessonsLearned: lessonsLearned || '',
        }),
        tags: ['repair_evaluation', 'repair'],
        source: 'repair_api',
        importance: 0.6,
      });

      res.status(201).json({ id, status: 'recorded' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/memory/repair — 查询修复评估
  router.get('/api/memory/repair', (_req: Request, res: Response) => {
    try {
      const entries = warmIndex.getByType('repair_evaluation');
      res.json({ entries, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Daily Log API（WorkBuddy 移植） ──

  // POST /api/memory/daily — 记录 Daily Log
  router.post('/api/memory/daily', (req: Request, res: Response) => {
    try {
      const { date, session_id, turn_count, content, summary, tags } = req.body;

      if (!date || !content) {
        res.status(400).json({ error: 'Required: date, content' });
        return;
      }

      // 验证日期格式 YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: 'Invalid date format. Must be YYYY-MM-DD' });
        return;
      }

      const id = coldMemory.logDaily({
        date,
        session_id: session_id || null,
        turn_count: turn_count || 0,
        content,
        summary: summary || null,
        tags: tags ? JSON.stringify(tags) : null,
      });

      res.status(201).json({ id, status: 'recorded' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/memory/daily — 查询 Daily Log
  router.get('/api/memory/daily', (req: Request, res: Response) => {
    try {
      const date = req.query.date as string | undefined;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;
      const limit = parseInt(req.query.limit as string) || 10;

      let logs;
      if (date) {
        logs = coldMemory.queryDailyLogs(date, limit);
      } else if (startDate && endDate) {
        logs = coldMemory.queryDailyLogsByRange(startDate, endDate);
      } else {
        // 默认返回最近 7 天
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        logs = coldMemory.queryDailyLogsByRange(weekAgo, today);
      }

      res.json({ logs, count: logs.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/memory/daily/stats — Daily Log 统计
  router.get('/api/memory/daily/stats', (_req: Request, res: Response) => {
    try {
      const stats = coldMemory.getDailyLogStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PUT /api/memory/daily/:id — 更新 Daily Log
  router.put('/api/memory/daily/:id', (req: Request, res: Response) => {
    try {
      const { content, summary, tags, turn_count } = req.body;
      const id = req.params.id;

      const success = coldMemory.updateDailyLog(id, {
        content,
        summary,
        tags: tags ? JSON.stringify(tags) : undefined,
        turn_count,
      });

      if (!success) {
        res.status(404).json({ error: 'Daily log not found' });
        return;
      }

      res.json({ id, status: 'updated' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
