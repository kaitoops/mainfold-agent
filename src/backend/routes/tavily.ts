/**
 * mainfold-agent — /api/search/tavily 路由
 *
 * 功能：暴露 Tavily 搜索为 Express 端点
 * 来源：移植自 WorkBuddy tavily_search.py
 * 迁移差异：TypeScript 原生实现，零 Python 依赖
 *
 * 使用方式：
 *   POST /api/search/tavily
 *   {"query": "...", "maxResults": 5, "depth": "basic"}
 */

import { Router, Request, Response } from 'express';
import { searchTavily } from '../tavily-service.js';

export function createTavilyRouter(apiKey: string): Router {
  const router = Router();

  // POST /api/search/tavily — 主搜索接口
  router.post('/api/search/tavily', async (req: Request, res: Response) => {
    if (!apiKey) {
      res.status(503).json({
        error: 'Tavily API key not configured',
        detail: 'Set TAVILY_API_KEY in .env to enable web search',
      });
      return;
    }

    const { query, maxResults, includeAnswer, depth } = req.body ?? {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'query (string) is required' });
      return;
    }

    try {
      const result = await searchTavily(apiKey, {
        query: query.trim(),
        maxResults: Math.min(Math.max(maxResults ?? 5, 1), 10),
        includeAnswer: includeAnswer === true,
        searchDepth: depth === 'advanced' ? 'advanced' : 'basic',
      });

      res.json(result);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[tavily] Search error: ${msg}`);
      res.status(502).json({ error: 'Tavily search failed', detail: msg });
    }
  });

  // GET /api/search/tavily/status — 检查 key 是否配置
  router.get('/api/search/tavily/status', (_req: Request, res: Response) => {
    res.json({
      configured: !!apiKey,
      source: 'mainfold-agent .env',
      priority: 'primary',
    });
  });

  return router;
}
