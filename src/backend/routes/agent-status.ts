/**
 * mainfold-agent — Agent 状态追踪模块
 *
 * 轻量级共享状态，由 chat.ts 在关键节点推入实时进度，
 * 前端通过 /api/agent/status 轮询获取。
 *
 * 设计原则：
 * - 单例内存状态（进程内，不持久化）
 * - 无锁同步（Node.js 事件循环单线程模型保证原子性）
 * - 仅保留最近 10 条历史供前端展示轨迹
 */

import { Router, Request, Response } from 'express';

// ── 类型 ──

export type AgentPhase =
  | 'idle'        // 空闲
  | 'api'         // 调用 DeepSeek API
  | 'tool'        // 执行工具
  | 'tool-result' // 工具执行完毕
  | 'refactor'    // 重构输出
  | 'finalizing'; // 生成最终回复

interface StatusEntry {
  phase: string;
  detail: string;
  timestamp: string;
}

interface AgentStatus {
  phase: AgentPhase;
  detail: string;
  toolName?: string;
  filePath?: string;
  timestamp: string;
  history: StatusEntry[];
  /** 自本轮对话开始以来的秒数 */
  elapsed: number;
}

// ── 状态（单例）──

let _dialogueStart: number | null = null;
let _status: AgentStatus = {
  phase: 'idle',
  detail: '等待中',
  timestamp: new Date().toISOString(),
  history: [],
  elapsed: 0,
};

// ── 导出函数 ──

/** 标记对话开始（由 chat.ts 在处理开始时调用） */
export function beginDialogue(): void {
  _dialogueStart = Date.now();
  const now = new Date().toISOString();
  _status = {
    phase: 'api',
    detail: '开始处理...',
    timestamp: now,
    history: [{ phase: 'start', detail: '对话开始', timestamp: now }],
    elapsed: 0,
  };
}

/** 推入一条实时状态 */
export function setAgentStatus(update: {
  phase: AgentPhase;
  detail: string;
  toolName?: string;
  filePath?: string;
}): void {
  const now = new Date().toISOString();
  const entry: StatusEntry = {
    phase: update.phase,
    detail: update.detail,
    timestamp: now,
  };

  _status.history.push(entry);
  if (_status.history.length > 20) {
    _status.history = _status.history.slice(-20);
  }

  _status = {
    ..._status,
    phase: update.phase,
    detail: update.detail,
    toolName: update.toolName ?? _status.toolName,
    filePath: update.filePath ?? _status.filePath,
    timestamp: now,
    elapsed: _dialogueStart ? Math.floor((Date.now() - _dialogueStart) / 1000) : 0,
  };
}

/** 重置到空闲状态 */
export function resetAgentStatus(): void {
  _dialogueStart = null;
  const now = new Date().toISOString();
  _status = {
    phase: 'idle',
    detail: '等待中',
    timestamp: now,
    history: [],
    elapsed: 0,
  };
}

/** 获取当前状态（供路由调用） */
export function getAgentStatus(): AgentStatus {
  // 如果对话已开始，动态计算 elapsed
  if (_dialogueStart && _status.phase !== 'idle') {
    return {
      ..._status,
      elapsed: Math.floor((Date.now() - _dialogueStart) / 1000),
    };
  }
  return _status;
}

// ── 工具名 → 中文标签（前端也保留一份，后端提供原始字段）──

export const TOOL_LABELS: Record<string, string> = {
  'read-file': '读取文件',
  'read_file': '读取文件',
  'write-file': '写入文件',
  'write_file': '写入文件',
  exec: '执行命令',
  ls: '浏览目录',
  git: 'Git 操作',
  http: 'HTTP 请求',
  esa_status: '自注意力检查',
  esa_focus: '注意力聚焦',
  esa_anchor: '锚点操作',
  self_scan: '代码扫描',
};

export const PHASE_LABELS: Record<AgentPhase, string> = {
  idle: '等待中',
  api: '调用 AI',
  tool: '执行操作',
  'tool-result': '操作完成',
  refactor: '优化输出',
  finalizing: '生成回复',
};

// ── 路由器 ──

export function createAgentStatusRouter(): Router {
  const router = Router();

  router.get('/api/agent/status', (_req: Request, res: Response) => {
    res.json(getAgentStatus());
  });

  return router;
}
