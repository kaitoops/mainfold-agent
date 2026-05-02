/**
 * mainfold-agent — Models Active 路由 (前端 M10 SettingsPage 模型激活)
 *
 * 运行逻辑提取自 Hermes SettingsPage：
 *   用户选择模型 → POST /api/models/active → 保存当前活跃模型
 *
 * 设计：
 *   - activeModel: 内存状态（进程内）
 *   - 默认：deepseek-v4-flash
 *   - GET 获取当前活跃模型，POST 切换
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

// ── 状态 ──

let activeModelId = 'deepseek-v4-flash';

// ── 验证 ──

const SetActiveModelSchema = z.object({
  model_id: z.string().min(1),
});

// ── 可用模型列表 ──

const AVAILABLE_MODELS = [
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-reasoner',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2.5-flash',
];

// ── 路由器 ──

export function createModelsRouter(): Router {
  const router = Router();

  // GET /api/models/active — 获取当前活跃模型
  router.get('/api/models/active', (_req: Request, res: Response) => {
    res.json({
      active_model: activeModelId,
      available: AVAILABLE_MODELS,
    });
  });

  // POST /api/models/active — 切换活跃模型
  router.post('/api/models/active', (req: Request, res: Response) => {
    const parsed = SetActiveModelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const { model_id } = parsed.data;

    if (!AVAILABLE_MODELS.includes(model_id)) {
      res.status(400).json({
        error: 'Unknown model',
        available: AVAILABLE_MODELS,
      });
      return;
    }

    const previousModel = activeModelId;
    activeModelId = model_id;

    console.log(`[models] Active model changed: ${previousModel} → ${activeModelId}`);

    res.json({
      active_model: activeModelId,
      previous_model: previousModel,
      status: 'switched',
    });
  });

  return router;
}
