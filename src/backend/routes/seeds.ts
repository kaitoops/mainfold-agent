/**
 * mainfold-agent — 心流种子路由
 *
 * 暴露心流种子的 CRUD 端点：
 *   POST /api/seeds — 播下种子
 *   GET  /api/seeds — 列出种子（按状态筛选）
 *   GET  /api/seeds/dormant — 获取休眠种子上下文（供 system_prompt 注入）
 */

import { Router, Request, Response } from 'express';
import { createSeed, listSeeds, getSeedsAsContext } from '../seeds.js';
import { KnowledgeGraph } from '../mempalace/knowledge_graph.js';

export function createSeedsRouter(kg: KnowledgeGraph): Router {
  const router = Router();

  // POST /api/seeds — 播下一颗新种子
  router.post('/api/seeds', (req: Request, res: Response) => {
    const { content, contextId, anchors } = req.body ?? {};
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content (string) is required' });
      return;
    }

    const result = createSeed(
      (name, etype, props) => kg.addEntity(name, etype, props),
      content.trim(),
      contextId,
      anchors,
    );

    console.log(`[seeds] New flow seed: ${result.id}`);
    res.status(201).json(result.seed);
  });

  // GET /api/seeds — 列出种子（可筛选 status）
  router.get('/api/seeds', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const validStatus = status === 'DORMANT' || status === 'SPROUTED' || status === 'ARCHIVED'
      ? status : undefined;

    const seeds = listSeeds(
      (t) => kg.getEntitiesByType(t),
      validStatus as any,
    );

    res.json({ count: seeds.length, seeds });
  });

  // GET /api/seeds/context — 返回种子上下文（供 system_prompt 注入）
  router.get('/api/seeds/context', (_req: Request, res: Response) => {
    const context = getSeedsAsContext((t) => kg.getEntitiesByType(t));
    res.json({ context });
  });

  // PATCH /api/seeds/:id — 更新种子状态
  router.patch('/api/seeds/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body ?? {};

    if (!status || !['DORMANT', 'SPROUTED', 'ARCHIVED'].includes(status)) {
      res.status(400).json({ error: 'status must be one of: DORMANT, SPROUTED, ARCHIVED' });
      return;
    }

    const entity = kg.getEntity(id);
    if (!entity) {
      res.status(404).json({ error: `Seed '${id}' not found` });
      return;
    }

    // 使用 INSERT OR REPLACE 更新状态（保留其他属性）
    const props = typeof entity.properties === 'object' ? entity.properties : {};
    kg.addEntity(id, 'flow_seed', {
      ...props,
      status,
    });

    console.log(`[seeds] Updated '${id}' → ${status}`);
    res.json({ id, status: status as string });
  });

  // DELETE /api/seeds/:id — 删除种子（设为 ARCHIVED）
  router.delete('/api/seeds/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const entity = kg.getEntity(id);
    if (!entity) {
      res.status(404).json({ error: `Seed '${id}' not found` });
      return;
    }

    const props = typeof entity.properties === 'object' ? entity.properties : {};
    kg.addEntity(id, 'flow_seed', {
      ...props,
      status: 'ARCHIVED',
    });

    console.log(`[seeds] Archived '${id}'`);
    res.json({ id, status: 'ARCHIVED' });
  });

  return router;
}
