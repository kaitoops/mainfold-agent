/**
 * mainfold-agent Backend — Phase 1 完全重写
 *
 * 根因文件重写自 G:/Hermes/webui/backend/app/main.py
 * 根因：/api/chat 无 SOUL.md 注入，导致 Agent 以 DeepSeek 默认身份响应
 *
 * 第一轮5模块耦合群（身份注入）：
 *   M1 soul-loader  — SOUL.md 加载器（启动断言+威胁扫描+幂等缓存）
 *   M2 identity-assert — 身份断言（验证 Agent 知道自己是谁）
 *   M3 routes/chat  — Chat 路由（强制注入 system_prompt，修复根因）
 *   M4 tri-state    — TRI 状态协调（A×S×H + HealthRatio 恒温器）
 *   M5 health-signal — 健康度信号（心跳监控+事件驱动）
 *
 * 耦合链：
 *   M1 → M2 → M3（身份加载→断言→注入）
 *   M5 → M4（信号触发→状态更新）
 *   M3 → M4+M5（对话后更新状态+ping心跳）
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';
import dotenv from 'dotenv';

// ── 路径常量 ──

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const SOUL_MD_PATH = path.join(WORKSPACE_ROOT, 'workspace', 'SOUL.md');
const EB006_PATH = path.join(WORKSPACE_ROOT, 'protocols', 'eb-006-context-guard.json');
const CONFIG_DIR = path.join(WORKSPACE_ROOT, 'config');

// 加载 .env（从项目根）
dotenv.config({ path: path.join(WORKSPACE_ROOT, '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const PORT = parseInt(process.env.PORT || '8000', 10);

import { loadSoulMd, buildSystemPrompt } from './soul-loader.js';

// ── M2: 身份断言 ──
import { assertIdentity, buildIdentityContext } from './identity-assert.js';

// ── M3: Chat 路由 ──
import { createChatRouter } from './routes/chat.js';

// ── M4: TRI-State 编排器 ──
import { TriStateOrchestrator } from './tri-state.js';

// ── M5: 健康度监控 ──
import { HealthMonitor } from './health-signal.js';

// ── 第二轮：WebUI 前端所需端点 ──
import { createInjectRouter } from './routes/inject.js';
import { createAgentStatusRouter } from './routes/agent-status.js';
import { createModelsRouter } from './routes/models.js';
import { createMemoriesRouter } from './routes/memories.js';
import { createSecurityRouter } from './routes/security.js';

// ── 第四轮：MemPalace 核心端点 ──
import { createMempalaceRouter } from './routes/mempalace.js';

// ── 第五轮：Tavily 搜索端点 ──
import { createTavilyRouter } from './routes/tavily.js';

// ── Phase D: 工具端点 ──
import { createToolsRouter } from './routes/tools.js';

// ── Phase E: 记忆层 ──
import { ColdMemory } from './memory/cold-db.js';
import { WarmIndex } from './memory/warm-index.js';
import { MemoryReviewer } from './memory/memory-reviewer.js';
import { createMemoryRouter } from './routes/memory.js';

// ── 第六轮：心流种子端点 ──
import { createSeedsRouter } from './routes/seeds.js';

// ── SICR 路由层 ──
import { createSicrRouter } from './routes/sicr-router.js';

// ── ESA: 具身自注意力认知架构 ──
import { ESACore, integrateTRIWithESA } from './esa-core.js';

// ── M6: 自代码自省模块 ──
import { createSelfScanRouter } from './routes/self-scan.js';

// ── EB-006 上下文守卫 ──

interface Eb006Config {
  window_config: {
    capacity_tokens: number;
    safety_threshold_tokens: number;
    optimization_suggest_tokens: number;
  };
}

function loadEb006(): Eb006Config | null {
  if (!fs.existsSync(EB006_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(EB006_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 启动序列：M1 → M2 → 初始化 M4+M5 → 注册 M3
// ══════════════════════════════════════════════════════════════════

console.log('[mainfold-agent] Starting...');

// Step 1: M1 — 加载 SOUL.md（失败 = 进程退出）
const soulResult = loadSoulMd(SOUL_MD_PATH);

// Step 2: M2 — 身份断言（失败 = 进程退出）
const identityResult = assertIdentity(soulResult);

// Step 3: 构建身份上下文（供 M3 使用）
const identityContext = buildIdentityContext(soulResult);
const SYSTEM_PROMPT = identityContext.systemPrompt;

// Step 4: M4 — 初始化 TRI-State
const triState = new TriStateOrchestrator({
  initialHealthRatio: 0.15,
});

// Step 5: M5 — 初始化健康监控
const healthMonitor = new HealthMonitor({
  intervalMs: 5000,
  timeoutMs: 30000,
  missThreshold: 3,
});

// Step 5.1: 绑定 M5 → M4
healthMonitor.bindTriState(triState);

// Step 5.2: 监听状态变化事件
healthMonitor.on('statusChange', (from, to) => {
  console.log(`[mainfold-agent] Health: ${from} → ${to}`);
});
healthMonitor.on('recover', () => {
  console.log('[mainfold-agent] Heartbeat recovered');
});

// Step 6: M3.5 — 初始化 ESA 具身自注意力架构
const esaCore = ESACore.getInstance();
console.log(`[mainfold-agent] ESA Core: FOCUS (initialized)`);

// Step 6.1: TRI ↔ ESA 集成（每当 TRI 更新时同步到 ESA）
const esaTriInterval = setInterval(() => {
  const dims = triState.getDimensions();
  integrateTRIWithESA(esaCore, dims);
}, 15_000); // 每 15 秒同步一次

// Step 7: 加载 EB-006
const eb006 = loadEb006();

// ── Phase E: 初始化记忆层 ──

// Step E1: 确保 config 目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Step E2: 初始化冷记忆（文件级 SQLite）
const coldMemory = new ColdMemory(path.join(CONFIG_DIR, 'cold_memory.sqlite3'));
console.log(`[mainfold-agent] ColdMemory: ${path.join(CONFIG_DIR, 'cold_memory.sqlite3')}`);

// Step E3: 初始化暖索引（JSON 文件）
const warmIndex = new WarmIndex(path.join(CONFIG_DIR, 'warm_memory.json'));
console.log(`[mainfold-agent] WarmIndex: ${path.join(CONFIG_DIR, 'warm_memory.json')}`);

// Step E4: 初始化记忆整理器（后台进程）
const memoryReviewer = new MemoryReviewer(coldMemory, warmIndex, {
  intervalMs: 5 * 60 * 1000,   // 5 分钟
  operationThreshold: 20,        // 20 条操作触发
  warmMaxEntries: 500,
  coldRetentionDays: 365,
  enabled: true,
});

// ══════════════════════════════════════════════════════════════════
// Express 应用
// ══════════════════════════════════════════════════════════════════

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ── 基础端点 ──

app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'mainfold-agent',
    version: '1.0.0-mainfold',
    identity: {
      loaded: true,
      preview: identityResult.identityPreview,
      source: soulResult.path,
    },
  });
});

// ── 健康检查 ──

app.get('/health', (_req: Request, res: Response) => {
  const triHealth = triState.healthCheck();
  const hbStatus = healthMonitor.getStatus();
  const eb6 = eb006?.window_config;

  res.json({
    status: triHealth.healthy ? 'healthy' : 'degraded',
    tri: triHealth.description,
    heartbeat: hbStatus.status,
    soul_md_loaded: true,
    eb006: eb6
      ? {
          capacity_tokens: eb6.capacity_tokens,
          safety_threshold_tokens: eb6.safety_threshold_tokens,
        }
      : null,
  });
});

// ── API 健康检查 ──

app.get('/api/health', (_req: Request, res: Response) => {
  const triDims = triState.getDimensions();
  const hbStatus = healthMonitor.getStatus();
  const triHealth = triState.healthCheck();
  const esa = ESACore.getInstance().getStatusReport();

  res.json({
    services: {
      backend: 'ok',
      deepseek_api: DEEPSEEK_API_KEY ? 'configured' : 'missing',
    },
    tri: {
      A: triDims.A,
      S: triDims.S,
      H: triDims.H,
      triScore: triState.computeTriScore(),
      state: triHealth.description,
    },
    esa: {
      state: esa.state,
      confidence: esa.confidence,
      attentionDecay: esa.attentionDecay,
      anchors: esa.anchorCount,
      stateDuration: esa.stateDuration,
    },
    heartbeat: hbStatus,
    identity: {
      loaded: true,
      source: soulResult.path,
    },
  });
});

// ── TRI 端点 ──

app.get('/api/tri', (_req: Request, res: Response) => {
  const dims = triState.getDimensions();
  const health = triState.healthCheck();
  res.json({
    ...dims,
    triScore: triState.computeTriScore(),
    state: health.healthy ? 'NORMAL' : health.description.split(':')[0],
    healthRatio: triState.getHealthRatio(),
    history: triState.getHistory(),
  });
});

app.post('/api/tri', (req: Request, res: Response) => {
  const { A, S, H } = req.body as { A?: number; S?: number; H?: number };

  // 验证
  const partial: Record<string, number> = {};
  if (A !== undefined) {
    if (typeof A !== 'number' || A < 0 || A > 1) {
      res.status(400).json({ error: 'A must be a number between 0 and 1' });
      return;
    }
    partial.A = A;
  }
  if (S !== undefined) {
    if (typeof S !== 'number' || S < 0 || S > 1) {
      res.status(400).json({ error: 'S must be a number between 0 and 1' });
      return;
    }
    partial.S = S;
  }
  if (H !== undefined) {
    if (typeof H !== 'number' || H < 0 || H > 1) {
      res.status(400).json({ error: 'H must be a number between 0 and 1' });
      return;
    }
    partial.H = H;
  }

  if (Object.keys(partial).length === 0) {
    res.status(400).json({ error: 'At least one of A, S, H must be provided' });
    return;
  }

  const snapshot = triState.update(partial as any);
  const dims = triState.getDimensions();
  const health = triState.healthCheck();
  res.json({
    ...dims,
    triScore: triState.computeTriScore(),
    state: health.healthy ? 'NORMAL' : health.description.split(':')[0],
    healthRatio: triState.getHealthRatio(),
    history: triState.getHistory(),
  });
});

// ── M3: Chat 路由 ──

import { listSeeds, createSeed } from './seeds.js';
import { rankCandidates } from './routes/sicr-router.js';
import type { SicrCandidate } from './routes/sicr-router.js';
const chatRouter = createChatRouter({
  systemPrompt: SYSTEM_PROMPT,
  triState,
  healthMonitor,
  apiKey: DEEPSEEK_API_KEY,
  coldMemory, // Phase E: 冷记忆日志
  getSeedContext: async (userMessage: string) => {
    const kg = getSharedKg();
    const dormant = listSeeds((t) => kg.getEntitiesByType(t), 'DORMANT');
    if (dormant.length === 0) return '';

    const candidatePool: SicrCandidate[] = dormant.map(s => ({
      id: s.id,
      text: `${s.content}${s.semanticAnchors ? ` [锚点: ${s.semanticAnchors.join(', ')}]` : ''}`,
    }));

    try {
      const sicrResult = await rankCandidates(userMessage, candidatePool, {
        topK: 3,
        minScore: 0.4,
      });

      if (sicrResult.results.length === 0) return '';

      const lines: string[] = [];
      for (const r of sicrResult.results) {
        const seed = dormant.find(s => s.id === r.id);
        if (!seed) continue;

        // 高相关性种子（score >= 0.55）自动发芽
        if (r.score >= 0.55) {
          kg.addEntity(r.id, 'flow_seed', {
            content: seed.content,
            status: 'SPROUTED',
            createdAt: seed.createdAt,
            contextId: seed.currentContextId ?? '',
            anchors: JSON.stringify(seed.semanticAnchors ?? []),
          });
          console.log(`[seed-gravity] Auto-sprouted: ${r.id} (score=${r.score.toFixed(2)})`);
          lines.push(`  [已发芽·${r.score.toFixed(2)}] ${seed.content}`);
        } else {
          lines.push(`  [休眠·${r.score.toFixed(2)}] ${seed.content}`);
        }
      }

      return lines.length > 0 ? `--- 心流种子（SICR 语义匹配）---\n${lines.join('\n')}` : '';
    } catch (err) {
      // SICR 失败时的降级：注入前 3 颗休眠种子
      console.error(`[seed-gravity] SICR failed, falling back: ${(err as Error).message}`);
      const fallback = dormant.slice(0, 3).map(s => `  ${s.content}`);
      return fallback.length > 0 ? `--- 心流种子（降级注入）---\n${fallback.join('\n')}` : '';
    }
  },
  seedFlowCb: (content: string) => {
    const kg = getSharedKg();
    createSeed(
      (name, etype, props) => kg.addEntity(name, etype, props),
      content,
    );
  },
});
app.use(chatRouter);

// ── 第二轮：Inject + Models 路由 ──

const injectRouter = createInjectRouter();
app.use(injectRouter);

// Agent 实时状态追踪（前端轮询用）
const agentStatusRouter = createAgentStatusRouter();
app.use(agentStatusRouter);

const modelsRouter = createModelsRouter();
app.use(modelsRouter);

const memoriesRouter = createMemoriesRouter();
app.use(memoriesRouter);

const securityRouter = createSecurityRouter();
app.use(securityRouter);

// ── 第四轮：MemPalace 核心路由（含 SICR 语义搜索）──

const MEMPALACE_KG_PATH = path.join(WORKSPACE_ROOT, 'config', 'mempalace_kg.sqlite3');
const mempalaceRouter = createMempalaceRouter(MEMPALACE_KG_PATH, {
  apiKey: DEEPSEEK_API_KEY,
  baseUrl: DEEPSEEK_BASE_URL,
});
app.use(mempalaceRouter);

// ── SICR 路由层 ──

const sicrRouter = createSicrRouter();
app.use(sicrRouter);

// ── 第五轮：Tavily 搜索路由 ──

const tavilyRouter = createTavilyRouter(TAVILY_API_KEY);
app.use(tavilyRouter);

// ── Phase D: 工具路由 ──

const toolsRouter = createToolsRouter({ coldMemory, warmIndex });
app.use(toolsRouter);

// ── Phase E: 记忆管理路由 ──

const memoryRouter = createMemoryRouter({ coldMemory, warmIndex, reviewer: memoryReviewer });
app.use(memoryRouter);

// ── 第六轮：心流种子路由 ──

import { getSharedKg } from './routes/mempalace.js';
const seedsRouter = createSeedsRouter(getSharedKg());
app.use(seedsRouter);

// ── M6: 自代码自省路由 ──

const selfScanRouter = createSelfScanRouter();
app.use(selfScanRouter);

// ── ESA: 注意力状态查询端点 ──

app.get('/api/esa/status', (_req: Request, res: Response) => {
  const report = ESACore.getInstance().getStatusReport();
  res.json(report);
});

app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error(`[mainfold-agent] Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ══════════════════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
  // 启动健康监控
  healthMonitor.start();

  // 首次心跳
  healthMonitor.heartbeat();

  // Phase E: 启动记忆整理器
  memoryReviewer.start();

  console.log(`[mainfold-agent] Backend started on http://0.0.0.0:${PORT}`);
  console.log(`[mainfold-agent] SOUL.md: ${soulResult.path} (${soulResult.body.length} chars)`);
  console.log(`[mainfold-agent] Identity: ${identityResult.identityPreview.slice(0, 50)}...`);
  console.log(`[mainfold-agent] EB-006: ${eb006 ? 'loaded' : 'not found'}`);
  console.log(`[mainfold-agent] TRI: A=${triState.getDimensions().A} S=${triState.getDimensions().S} H=${triState.getDimensions().H}`);
  console.log(`[mainfold-agent] DeepSeek API: ${DEEPSEEK_API_KEY ? 'configured' : 'NOT CONFIGURED'}`);
  console.log(`[mainfold-agent] Phase E: ColdMemory+WarmIndex+MemoryReviewer active`);
  console.log(`[mainfold-agent] SICR router: /api/sicr/search (Scaffolded In-Context Retrieval)`);
  console.log(`[mainfold-agent] ESA Core: ${esaCore.state} (confidence=${esaCore.confidence.toFixed(2)})`);
  console.log(`[mainfold-agent] Self-Scan: /api/self/scan + /api/self/files + /api/self/query`);
});
