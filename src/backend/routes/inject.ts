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
import fs from 'fs';
import path from 'path';
import { createTask } from './task-tracker.js';

// ── 注入队列 ──

interface InjectMessage {
  id: string;
  taskId: string | null;  // 关联的任务 ID（由 task-tracker 生成）
  content: string;
  source: string;       // 'workbuddy' | 'system' | 'manual'
  timestamp: string;
  priority: number;     // 0=低, 1=普通, 2=高
  delivered: boolean;   // 是否已送达（被前端消费）
  deliveredAt: string | null; // 送达时间
}

const injectQueue: InjectMessage[] = [];

// ── 消息持久化（防止重启丢失）──
const INJECT_LOG_PATH = path.join(
  process.env.WORKSPACE_ROOT || process.cwd(),
  'data',
  'inject_log.json',
);

function ensureInjectLogDir() {
  const dir = path.dirname(INJECT_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendInjectLog(msg: InjectMessage): void {
  try {
    ensureInjectLogDir();
    const existing = fs.existsSync(INJECT_LOG_PATH)
      ? JSON.parse(fs.readFileSync(INJECT_LOG_PATH, 'utf-8'))
      : [];
    existing.push(msg);
    // 只保留最近 1000 条
    const trimmed = existing.slice(-1000);
    fs.writeFileSync(INJECT_LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    console.error('[inject] Failed to write inject log:', err);
  }
}

function updateInjectLog(msg: InjectMessage): void {
  try {
    if (!fs.existsSync(INJECT_LOG_PATH)) return;
    const existing = JSON.parse(fs.readFileSync(INJECT_LOG_PATH, 'utf-8'));
    const idx = existing.findIndex((m: InjectMessage) => m.id === msg.id);
    if (idx !== -1) {
      existing[idx] = msg;
      fs.writeFileSync(INJECT_LOG_PATH, JSON.stringify(existing, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[inject] Failed to update inject log:', err);
  }
}

// ── 自动确认授权状态（持久化到磁盘）──

interface AutoConfirmState {
  enabled: boolean;           // 是否启用自动确认
  remainingCount: number;     // 剩余自动确认次数
  totalCount: number;         // 总授权次数
  authorizedAt: string;       // 授权时间
  lastInjectAt: string | null; // 最近一次注入时间
}

const AUTO_CONFIRM_STATE_PATH = path.join(
  process.env.WORKSPACE_ROOT || process.cwd(),
  'data',
  'auto_confirm_state.json',
);

function loadAutoConfirmState(): AutoConfirmState {
  try {
    if (fs.existsSync(AUTO_CONFIRM_STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(AUTO_CONFIRM_STATE_PATH, 'utf-8'));
      console.log(`[inject] Loaded auto-confirm state: remaining=${data.remainingCount}, enabled=${data.enabled}`);
      return data;
    }
  } catch (err) {
    console.error('[inject] Failed to load auto-confirm state:', err);
  }
  return {
    enabled: false,
    remainingCount: 0,
    totalCount: 0,
    authorizedAt: '',
    lastInjectAt: null,
  };
}

function saveAutoConfirmState(): void {
  try {
    const dir = path.dirname(AUTO_CONFIRM_STATE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AUTO_CONFIRM_STATE_PATH, JSON.stringify(autoConfirmState, null, 2), 'utf-8');
  } catch (err) {
    console.error('[inject] Failed to save auto-confirm state:', err);
  }
}

let autoConfirmState: AutoConfirmState = loadAutoConfirmState();

/** 检测内容中是否包含 [WB-AUTH:N] 标记 */
function extractAuthMarker(content: string): number | null {
  const match = content.match(/\[WB-AUTH:(\d+)\]/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/** 消费自动确认消息（不经过用户确认） */
function autoConsumeMessage(msg: InjectMessage): void {
  const idx = injectQueue.findIndex((m) => m.id === msg.id);
  if (idx !== -1) {
    injectQueue.splice(idx, 1);
  }
  autoConfirmState.remainingCount--;
  autoConfirmState.lastInjectAt = new Date().toISOString();
  saveAutoConfirmState();
  
  if (autoConfirmState.remainingCount <= 0) {
    autoConfirmState.enabled = false;
    saveAutoConfirmState();
    console.log(`[inject] Auto-confirm exhausted, disabled`);
  } else {
    console.log(`[inject] Auto-consumed: ${msg.id}, remaining: ${autoConfirmState.remainingCount}`);
  }
}

/** 跨模块：工具权限请求推送到注入队列（由 tools.ts 的 safeResolve 在遇到未授权路径时调用） */
export function pushPermissionRequest(absolutePath: string, toolName: string, detail?: string): string {
  const msg: InjectMessage = {
    id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: null,  // 权限请求不关联任务
    content: `[权限请求] Agent 需要通过 "${toolName}" 访问路径:\n  ${absolutePath}${detail ? '\n  上下文: ' + detail : ''}\n\n如需授予永久权限，将路径添加到安全设置的 allowed_extra_paths。`,
    source: 'system',
    timestamp: new Date().toISOString(),
    priority: 2,
    delivered: false,
    deliveredAt: null,
  };
  injectQueue.push(msg);
  console.log(`[inject] Permission request queued: ${toolName} → ${absolutePath} (${msg.id})`);
  return msg.id;
}

// ── 请求验证 ──

const InjectRequestSchema = z.object({
  content: z.string().min(1),
  source: z.string().default('manual'),
  priority: z.number().int().min(0).max(2).default(1),
});

// ── 路由器 ──

export function createInjectRouter(): Router {
  const router = Router();

  // GET /api/inject — 前端轮询获取待注入消息（别名，兼容直觉命名）
  router.get('/api/inject', (_req: Request, res: Response) => {
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

  // GET /api/inject/pending — 前端轮询获取待注入消息（原始端点）
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

  // POST /api/inject — 外部系统注入消息（别名，兼容直觉命名）
  router.post('/api/inject', (req: Request, res: Response) => {
    const parsed = InjectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const msg: InjectMessage = {
      id: `inject_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: null,  // 将由 task-tracker 生成
      content: parsed.data.content,
      source: parsed.data.source,
      timestamp: new Date().toISOString(),
      priority: parsed.data.priority,
      delivered: false,
      deliveredAt: null,
    };

    // ── 检测 [WB-AUTH:N] 授权标记 ──
    // 注意：[WB-AUTH:N] 只设置授权额度，不自动激活
    // 需要人类在前端点击"确认授权"按钮才能激活自动确认模式
    const authCount = extractAuthMarker(msg.content);
    if (authCount !== null) {
      // 只设置额度，不激活（enabled 保持 false，等待人类确认）
      autoConfirmState = {
        enabled: false,  // 等待人类确认
        remainingCount: authCount,
        totalCount: authCount,
        authorizedAt: new Date().toISOString(),
        lastInjectAt: null,
      };
      saveAutoConfirmState();
      console.log(`[inject] Auto-confirm quota set: ${authCount} times (waiting for human confirmation)`);
      
      // 从内容中移除授权标记，只保留实际任务内容
      msg.content = msg.content.replace(/\[WB-AUTH:\d+\]\s*/g, '').trim();
      if (!msg.content) {
        // 如果移除标记后内容为空，返回授权确认
        res.status(200).json({ 
          id: msg.id, 
          status: 'authorized',
          autoConfirm: {
            enabled: true,
            remainingCount: authCount,
            totalCount: authCount,
          }
        });
        return;
      }
    }

    injectQueue.push(msg);
    appendInjectLog(msg);
    console.log(`[inject] New message from ${msg.source}: ${msg.content.slice(0, 50)}...`);

    // 创建关联任务
    const task = createTask({
      injectId: msg.id,
      content: msg.content,
      source: msg.source,
      metadata: { priority: msg.priority },
    });
    msg.taskId = task.id;
    updateInjectLog(msg);  // 更新持久化日志中的 taskId

    // 返回状态（包含自动确认信息，由前端决定是否自动消费）
    res.status(201).json({ 
      id: msg.id, 
      taskId: msg.taskId,
      status: 'queued',
      delivered: false,
      autoConfirm: autoConfirmState.enabled ? {
        enabled: true,
        remainingCount: autoConfirmState.remainingCount,
      } : undefined,
    });
  });

  // POST /api/inject/pending — 外部系统注入消息（原始端点）
  router.post('/api/inject/pending', (req: Request, res: Response) => {
    const parsed = InjectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const msg: InjectMessage = {
      id: `inject_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: null,  // 将由 task-tracker 生成
      content: parsed.data.content,
      source: parsed.data.source,
      timestamp: new Date().toISOString(),
      priority: parsed.data.priority,
      delivered: false,
      deliveredAt: null,
    };

    // ── 检测 [WB-AUTH:N] 授权标记 ──
    // 注意：[WB-AUTH:N] 只设置授权额度，不自动激活
    // 需要人类在前端点击"确认授权"按钮才能激活自动确认模式
    const authCount = extractAuthMarker(msg.content);
    if (authCount !== null) {
      // 只设置额度，不激活（enabled 保持 false，等待人类确认）
      autoConfirmState = {
        enabled: false,  // 等待人类确认
        remainingCount: authCount,
        totalCount: authCount,
        authorizedAt: new Date().toISOString(),
        lastInjectAt: null,
      };
      saveAutoConfirmState();
      console.log(`[inject] Auto-confirm quota set: ${authCount} times (waiting for human confirmation)`);
      
      // 从内容中移除授权标记，只保留实际任务内容
      msg.content = msg.content.replace(/\[WB-AUTH:\d+\]\s*/g, '').trim();
      if (!msg.content) {
        // 如果移除标记后内容为空，返回授权等待确认
        res.status(200).json({ 
          id: msg.id, 
          status: 'awaiting_confirmation',
          autoConfirm: {
            enabled: false,
            remainingCount: authCount,
            totalCount: authCount,
            message: '授权额度已设置，等待人类确认',
          }
        });
        return;
      }
    }

    injectQueue.push(msg);
    appendInjectLog(msg);
    console.log(`[inject] New message from ${msg.source}: ${msg.content.slice(0, 50)}...`);

    // 创建关联任务
    const task = createTask({
      injectId: msg.id,
      content: msg.content,
      source: msg.source,
      metadata: { priority: msg.priority },
    });
    msg.taskId = task.id;
    updateInjectLog(msg);  // 更新持久化日志中的 taskId

    // 返回状态（包含自动确认信息，由前端决定是否自动消费）
    res.status(201).json({ 
      id: msg.id, 
      taskId: msg.taskId,
      status: 'queued',
      delivered: false,
      autoConfirm: autoConfirmState.enabled ? {
        enabled: true,
        remainingCount: autoConfirmState.remainingCount,
      } : undefined,
    });
  });

  // DELETE /api/inject/pending/:id — 前端确认消费消息
  router.delete('/api/inject/pending/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const idx = injectQueue.findIndex((m) => m.id === id);

    if (idx === -1) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const msg = injectQueue[idx];
    msg.delivered = true;
    msg.deliveredAt = new Date().toISOString();
    updateInjectLog(msg);
    injectQueue.splice(idx, 1);

    // 如果是自动确认模式，扣减授权计数
    if (autoConfirmState.enabled && autoConfirmState.remainingCount > 0) {
      autoConfirmState.remainingCount--;
      autoConfirmState.lastInjectAt = new Date().toISOString();
      saveAutoConfirmState();
      
      if (autoConfirmState.remainingCount <= 0) {
        autoConfirmState.enabled = false;
        saveAutoConfirmState();
        console.log(`[inject] Auto-confirm exhausted, disabled`);
      } else {
        console.log(`[inject] Auto-consumed: ${id}, remaining: ${autoConfirmState.remainingCount}`);
      }
    }

    res.json({ 
      status: 'consumed', 
      id,
      taskId: msg.taskId,
      delivered: true,
      deliveredAt: msg.deliveredAt,
      autoConfirm: autoConfirmState.enabled ? {
        enabled: true,
        remainingCount: autoConfirmState.remainingCount,
      } : { enabled: false, remainingCount: 0 },
    });
  });

  // GET /api/inject/auto-confirm-status — 查询自动确认状态
  router.get('/api/inject/auto-confirm-status', (_req: Request, res: Response) => {
    res.json({
      enabled: autoConfirmState.enabled,
      remainingCount: autoConfirmState.remainingCount,
      totalCount: autoConfirmState.totalCount,
      authorizedAt: autoConfirmState.authorizedAt,
      lastInjectAt: autoConfirmState.lastInjectAt,
    });
  });

  // POST /api/inject/auto-confirm/cancel — 取消自动确认
  router.post('/api/inject/auto-confirm/cancel', (_req: Request, res: Response) => {
    const wasEnabled = autoConfirmState.enabled;
    autoConfirmState = {
      enabled: false,
      remainingCount: 0,
      totalCount: 0,
      authorizedAt: '',
      lastInjectAt: null,
    };
    saveAutoConfirmState();
    console.log(`[inject] Auto-confirm cancelled`);
    res.json({ 
      status: 'cancelled',
      wasEnabled,
    });
  });

  // POST /api/inject/auto-confirm/authorize — 手动授权自动确认（UI 按钮触发）
  router.post('/api/inject/auto-confirm/authorize', (req: Request, res: Response) => {
    const { count } = req.body as { count?: number };
    
    if (!count || count < 1 || count > 1000) {
      res.status(400).json({ error: 'count must be between 1 and 1000' });
      return;
    }

    autoConfirmState = {
      enabled: true,
      remainingCount: count,
      totalCount: count,
      authorizedAt: new Date().toISOString(),
      lastInjectAt: null,
    };
    saveAutoConfirmState();

    console.log(`[inject] Manual auto-confirm authorized: ${count} times`);
    res.json({
      status: 'authorized',
      autoConfirm: {
        enabled: true,
        remainingCount: count,
        totalCount: count,
      },
    });
  });

  // GET /api/inject/delivered/:id — 检查消息是否已送达（WorkBuddy 轮询用）
  router.get('/api/inject/delivered/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    
    // 先检查内存队列
    const inQueue = injectQueue.find((m) => m.id === id);
    if (inQueue) {
      res.json({ 
        id, 
        taskId: inQueue.taskId,
        delivered: inQueue.delivered, 
        deliveredAt: inQueue.deliveredAt,
        status: 'pending',
      });
      return;
    }

    // 再检查持久化日志
    try {
      if (fs.existsSync(INJECT_LOG_PATH)) {
        const log = JSON.parse(fs.readFileSync(INJECT_LOG_PATH, 'utf-8'));
        const msg = log.find((m: InjectMessage) => m.id === id);
        if (msg) {
          res.json({ 
            id, 
            taskId: msg.taskId,
            delivered: msg.delivered, 
            deliveredAt: msg.deliveredAt,
            status: msg.delivered ? 'delivered' : 'expired',
          });
          return;
        }
      }
    } catch (err) {
      console.error('[inject] Failed to read inject log:', err);
    }

    res.status(404).json({ error: 'Message not found', delivered: false });
  });

  // GET /api/inject/stats — 注入统计（WorkBuddy 监控用）
  router.get('/api/inject/stats', (_req: Request, res: Response) => {
    const pending = injectQueue.filter((m) => !m.delivered).length;
    const total = injectQueue.length;
    
    let deliveredCount = 0;
    let totalCount = 0;
    try {
      if (fs.existsSync(INJECT_LOG_PATH)) {
        const log = JSON.parse(fs.readFileSync(INJECT_LOG_PATH, 'utf-8'));
        totalCount = log.length;
        deliveredCount = log.filter((m: InjectMessage) => m.delivered).length;
      }
    } catch (err) {
      console.error('[inject] Failed to read inject log:', err);
    }

    res.json({
      queue: { pending, total },
      history: { delivered: deliveredCount, total: totalCount },
      autoConfirm: {
        enabled: autoConfirmState.enabled,
        remainingCount: autoConfirmState.remainingCount,
      },
    });
  });

  return router;
}
