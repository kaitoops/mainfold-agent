/**
 * mainfold-agent — MemPalace 路由 (耦合群 C — MemPalace 核心)
 *
 * 暴露 MemPalace 5个 TS 模块为 Express 端点：
 *   KnowledgeGraph — 知识图谱 CRUD + 查询
 *   EntityRegistry — 实体注册 + 检测
 *   MemorySearcher — 搜索 + 图遍历
 *   normalize/chunk — 对话标准化
 *   Pathfinder — 卡死检测 + 路径导航
 *
 * 存储：better-sqlite3 文件数据库（持久化路径: CONFIG_DIR/mempalace_kg.sqlite3）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as path from 'path';

import { KnowledgeGraph } from '../mempalace/knowledge_graph.js';
import { EntityRegistry, extractCandidates, scoreEntity, classifyEntity } from '../mempalace/entity_registry.js';
import { MemorySearcher } from '../mempalace/searcher.js';
import { normalize, chunkExchanges, detectConvoRoom } from '../mempalace/normalize.js';
import { detectStuck, createPathSession, generateCandidates } from '../mempalace/pathfinder.js';
import type { TriDimensions } from '../tri-state.js';

// ── 单例：KnowledgeGraph（进程级，所有路由共享）──

let _kgDbPath: string = '';
let kg: KnowledgeGraph;
let registry: EntityRegistry;
let searcher: MemorySearcher;

function getKg(): KnowledgeGraph {
  if (!kg) {
    kg = new KnowledgeGraph(_kgDbPath);
  }
  return kg;
}

/**
 * 暴露共享的 KnowledgeGraph 实例给其他路由（如 seeds 路由）
 */
export function getSharedKg(): KnowledgeGraph {
  return getKg();
}

function getRegistry(): EntityRegistry {
  if (!registry) {
    registry = new EntityRegistry();
  }
  return registry;
}

function getSearcher(): MemorySearcher {
  if (!searcher) {
    searcher = new MemorySearcher(getKg());
  }
  return searcher;
}

// ── 验证 schema ──

const addEntitySchema = z.object({
  name: z.string().min(1),
  type: z.string().optional().default('unknown'),
  properties: z.record(z.any()).optional().default({}),
});

const addTripleSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  sourceCloset: z.string().optional(),
  sourceFile: z.string().optional(),
});

const invalidateTripleSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  ended: z.string().optional(),
});

const learnSchema = z.object({
  text: z.string().min(1),
  minConfidence: z.number().optional().default(0.75),
});

const pathfindSchema = z.object({
  A: z.number().min(0).max(1),
  S: z.number().min(0).max(1),
  H: z.number().min(0).max(1),
});

// ── 创建路由 ──

export function createMempalaceRouter(kgDbPath: string) {
  // 设置数据库路径（供内部 getKg 使用）
  _kgDbPath = kgDbPath;
  const router = Router();

  // ══════════════════════════════════════════════
  // 状态
  // ══════════════════════════════════════════════

  router.get('/api/mempalace/status', (_req: Request, res: Response) => {
    const k = getKg();
    const r = getRegistry();
    const stats = k.stats();
    res.json({
      initialized: true,
      phase: 'phase2',
      database: kgDbPath,
      stats,
      registry: r.summary(),
    });
  });

  // ══════════════════════════════════════════════
  // 实体
  // ══════════════════════════════════════════════

  /** 搜索实体 */
  router.get('/api/mempalace/entities', (req: Request, res: Response) => {
    const query = (req.query.q as string) || '';
    if (!query) {
      // 无查询时返回统计
      const stats = getKg().stats();
      res.json({ entities: stats.entities, triples: stats.triples });
      return;
    }
    const s = getSearcher();
    const results = s.search(query);
    res.json({ query, results });
  });

  /** 获取单个实体 */
  router.get('/api/mempalace/entities/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    const entity = getKg().getEntity(name);
    if (!entity) {
      res.status(404).json({ error: `Entity '${name}' not found` });
      return;
    }
    const triples = getKg().queryEntity(name, undefined, 'both');
    res.json({ entity, triples });
  });

  /** 创建实体 */
  router.post('/api/mempalace/entities', (req: Request, res: Response) => {
    const parsed = addEntitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { name, type, properties } = parsed.data;
    const id = getKg().addEntity(name, type, properties);
    res.json({ id, name, type });
  });

  // ══════════════════════════════════════════════
  // 三元组
  // ══════════════════════════════════════════════

  /** 查询三元组（按谓词或实体） */
  router.get('/api/mempalace/triples', (req: Request, res: Response) => {
    const predicate = req.query.predicate as string | undefined;
    const entity = req.query.entity as string | undefined;
    const asOf = req.query.as_of as string | undefined;

    if (predicate) {
      const results = getKg().queryRelationship(predicate, asOf);
      res.json({ predicate, results, count: results.length });
      return;
    }
    if (entity) {
      const results = getKg().queryEntity(entity, asOf, 'both');
      res.json({ entity, results, count: results.length });
      return;
    }
    res.json({ error: 'Provide ?predicate= or ?entity=' });
  });

  /** 添加三元组 */
  router.post('/api/mempalace/triples', (req: Request, res: Response) => {
    const parsed = addTripleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { subject, predicate, object, ...opts } = parsed.data;
    const id = getKg().addTriple(subject, predicate, object, opts);
    res.json({ id, subject, predicate, object });
  });

  /** 失效三元组 */
  router.delete('/api/mempalace/triples', (req: Request, res: Response) => {
    const parsed = invalidateTripleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { subject, predicate, object, ended } = parsed.data;
    getKg().invalidate(subject, predicate, object, ended);
    res.json({ ok: true, message: `Triple invalidated: ${subject} ${predicate} ${object}` });
  });

  /** 时间线 */
  router.get('/api/mempalace/timeline', (req: Request, res: Response) => {
    const entity = req.query.entity as string | undefined;
    const timeline = getKg().timeline(entity);
    res.json({ entity: entity ?? '(all)', timeline, count: timeline.length });
  });

  // ══════════════════════════════════════════════
  // 图谱遍历 + 搜索
  // ══════════════════════════════════════════════

  /** 图谱遍历 */
  router.get('/api/mempalace/traverse', (req: Request, res: Response) => {
    const entity = req.query.entity as string;
    if (!entity) {
      res.status(400).json({ error: 'Provide ?entity= to start traversal' });
      return;
    }
    const maxHops = parseInt(req.query.max_hops as string) || 2;
    const s = getSearcher();
    const paths = s.traverseGraph(entity, maxHops);
    res.json({ start: entity, maxHops, paths, count: paths.length });
  });

  /** 隧道检测 */
  router.get('/api/mempalace/tunnels', (_req: Request, res: Response) => {
    const s = getSearcher();
    const tunnels = s.findTunnels();
    res.json({ tunnels, count: tunnels.length });
  });

  /** 图谱统计 */
  router.get('/api/mempalace/stats', (_req: Request, res: Response) => {
    const stats = getKg().stats();
    res.json(stats);
  });

  // ══════════════════════════════════════════════
  // 实体注册 + 学习
  // ══════════════════════════════════════════════

  /** 实体注册状态 */
  router.get('/api/mempalace/registry', (_req: Request, res: Response) => {
    const r = getRegistry();
    res.json({
      people: r.people,
      projects: r.projects,
      summary: r.summary(),
    });
  });

  /** 种子实体 */
  router.post('/api/mempalace/registry/seed', (req: Request, res: Response) => {
    const { mode, people, projects, aliases } = req.body as any;
    if (!mode || !people) {
      res.status(400).json({ error: 'Provide mode and people' });
      return;
    }
    getRegistry().seed(mode, people, projects ?? [], aliases);
    res.json({ ok: true, summary: getRegistry().summary() });
  });

  /** 从文本学习实体 */
  router.post('/api/mempalace/learn', (req: Request, res: Response) => {
    const parsed = learnSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { text, minConfidence } = parsed.data;
    const candidates = getRegistry().learnFromText(text, minConfidence);
    res.json({ candidates, count: candidates.length });
  });

  /** 从文本提取候选 */
  router.post('/api/mempalace/detect', (req: Request, res: Response) => {
    const { text } = req.body as any;
    if (!text) {
      res.status(400).json({ error: 'Provide text' });
      return;
    }
    const candidates = extractCandidates(text);
    // Score each
    const lines = text.split('\n');
    const scored = Object.entries(candidates).map(([name, frequency]) => {
      const signals = scoreEntity(name, text, lines);
      const entity = classifyEntity(name, frequency, signals);
      return entity;
    });
    res.json({ candidates: scored, count: scored.length });
  });

  // ══════════════════════════════════════════════
  // 对话标准化
  // ══════════════════════════════════════════════

  /** 标准化对话 */
  router.post('/api/mempalace/normalize', (req: Request, res: Response) => {
    const { content } = req.body as any;
    if (!content) {
      res.status(400).json({ error: 'Provide content' });
      return;
    }
    const normalized = normalize(content);
    res.json({ normalized, length: normalized.length });
  });

  /** 分块 */
  router.post('/api/mempalace/chunk', (req: Request, res: Response) => {
    const { content } = req.body as any;
    if (!content) {
      res.status(400).json({ error: 'Provide content' });
      return;
    }
    const chunks = chunkExchanges(content);
    const room = detectConvoRoom(content);
    res.json({ chunks, count: chunks.length, detectedRoom: room });
  });

  // ══════════════════════════════════════════════
  // 路径导航
  // ══════════════════════════════════════════════

  /** 检测是否卡死 + 生成候选 */
  router.post('/api/mempalace/pathfind', (req: Request, res: Response) => {
    const parsed = pathfindSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide A, S, H (0-1)' });
      return;
    }
    const tri: TriDimensions = parsed.data;
    const stuck = detectStuck(tri);
    const session = createPathSession(tri);
    const candidates = generateCandidates(tri);

    res.json({
      stuck,
      session,
      candidates,
    });
  });

  return router;
}
