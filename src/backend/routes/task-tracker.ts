/**
 * mainfold-agent — 任务状态追踪模块
 *
 * 职责：
 *   1. 追踪 WorkBuddy 注入任务的执行状态
 *   2. 提供任务状态查询 API
 *   3. 支持任务状态更新和历史记录
 *
 * 设计原则：
 *   - 单例内存状态（进程内，不持久化）
 *   - 无锁同步（Node.js 事件循环单线程模型保证原子性）
 *   - 仅保留最近 100 条任务历史
 */

import { Router, Request, Response } from 'express';

// ── 类型 ──

export type TaskStatus = 
  | 'pending'      // 等待处理
  | 'received'     // 已接收（前端已获取）
  | 'processing'   // 处理中（AI 正在执行）
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'cancelled';   // 已取消

export interface Task {
  id: string;
  injectId: string;        // 关联的注入消息 ID
  content: string;         // 任务内容摘要
  source: string;          // 来源（workbuddy/system/manual）
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;   // 执行结果摘要
  error: string | null;    // 错误信息
  metadata: Record<string, any>;  // 额外元数据
}

// ── 状态（单例）──

const _tasks: Map<string, Task> = new Map();
const _taskHistory: Task[] = [];
const MAX_HISTORY = 100;

// ── 导出函数 ──

/** 创建新任务 */
export function createTask(params: {
  injectId: string;
  content: string;
  source: string;
  metadata?: Record<string, any>;
}): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    injectId: params.injectId,
    content: params.content.slice(0, 200),  // 截断长内容
    source: params.source,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    receivedAt: null,
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    metadata: params.metadata || {},
  };

  _tasks.set(task.id, task);
  console.log(`[task-tracker] Created task: ${task.id} (inject: ${task.injectId})`);
  return task;
}

/** 更新任务状态 */
export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  options?: {
    result?: string;
    error?: string;
    metadata?: Record<string, any>;
  }
): Task | null {
  const task = _tasks.get(taskId);
  if (!task) {
    console.warn(`[task-tracker] Task not found: ${taskId}`);
    return null;
  }

  const now = new Date().toISOString();
  task.status = status;
  task.updatedAt = now;

  switch (status) {
    case 'received':
      task.receivedAt = now;
      break;
    case 'processing':
      task.startedAt = now;
      break;
    case 'completed':
      task.completedAt = now;
      if (options?.result) task.result = options.result.slice(0, 500);
      break;
    case 'failed':
      task.completedAt = now;
      if (options?.error) task.error = options.error.slice(0, 500);
      break;
    case 'cancelled':
      task.completedAt = now;
      break;
  }

  if (options?.metadata) {
    task.metadata = { ...task.metadata, ...options.metadata };
  }

  // 添加到历史记录
  _taskHistory.push({ ...task });
  if (_taskHistory.length > MAX_HISTORY) {
    _taskHistory.splice(0, _taskHistory.length - MAX_HISTORY);
  }

  console.log(`[task-tracker] Updated task ${taskId}: ${status}`);
  return task;
}

/** 获取任务 */
export function getTask(taskId: string): Task | null {
  return _tasks.get(taskId) || null;
}

/** 获取所有活跃任务 */
export function getActiveTasks(): Task[] {
  return Array.from(_tasks.values()).filter(
    (t) => !['completed', 'failed', 'cancelled'].includes(t.status)
  );
}

/** 获取任务历史 */
export function getTaskHistory(limit: number = 20): Task[] {
  return _taskHistory.slice(-limit);
}

/** 清理已完成的任务（保留最近 N 条） */
export function cleanupTasks(keepRecent: number = 50): number {
  const completedTasks = Array.from(_tasks.values()).filter(
    (t) => ['completed', 'failed', 'cancelled'].includes(t.status)
  );

  if (completedTasks.length <= keepRecent) {
    return 0;
  }

  // 按完成时间排序，删除最旧的
  completedTasks.sort(
    (a, b) => new Date(a.completedAt || a.updatedAt).getTime() - 
              new Date(b.completedAt || b.updatedAt).getTime()
  );

  const toDelete = completedTasks.slice(0, completedTasks.length - keepRecent);
  for (const task of toDelete) {
    _tasks.delete(task.id);
  }

  console.log(`[task-tracker] Cleaned up ${toDelete.length} old tasks`);
  return toDelete.length;
}

// ── 路由器 ──

export function createTaskTrackerRouter(): Router {
  const router = Router();

  // GET /api/tasks — 获取所有活跃任务
  router.get('/api/tasks', (_req: Request, res: Response) => {
    const activeTasks = getActiveTasks();
    res.json({
      tasks: activeTasks,
      count: activeTasks.length,
    });
  });

  // GET /api/tasks/history — 获取任务历史（必须在 /api/tasks/:id 之前）
  router.get('/api/tasks/history', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = getTaskHistory(limit);
    res.json({
      tasks: history,
      count: history.length,
    });
  });

  // GET /api/tasks/:id — 获取单个任务状态
  router.get('/api/tasks/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const task = getTask(id);
    
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  });

  // POST /api/tasks/:id/status — 更新任务状态（供 mainfold-agent 内部调用）
  router.post('/api/tasks/:id/status', (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, result, error, metadata } = req.body;

    if (!status || !['pending', 'received', 'processing', 'completed', 'failed', 'cancelled'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const task = updateTaskStatus(id, status, { result, error, metadata });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  });

  // POST /api/tasks/cleanup — 清理已完成任务
  router.post('/api/tasks/cleanup', (req: Request, res: Response) => {
    const { keepRecent } = req.body as { keepRecent?: number };
    const deleted = cleanupTasks(keepRecent || 50);
    res.json({ deleted, message: `Cleaned up ${deleted} old tasks` });
  });

  return router;
}
