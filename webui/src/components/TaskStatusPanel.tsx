/**
 * TaskStatusPanel — 顶部状态栏集合
 *
 * 从 ChatPage.tsx 提取，包含：
 *   1. AutoConfirmStatus — 自动确认授权状态
 *   2. ActiveTasksBar — 活跃任务列表
 *   3. InjectMessagesBar — 注入消息通知
 *
 * AutoConfirmStatus 原是 ChatPage.tsx 底部的独立组件，现移入此文件。
 * 所有状态由父组件管理，通过 props 传入。
 */

import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';

// ── 类型 ──

interface InjectMessage {
  id: string;
  taskId: string | null;
  content: string;
  source: string;
  timestamp: string;
  priority: number;
}

interface Task {
  id: string;
  injectId: string;
  content: string;
  source: string;
  status: 'pending' | 'received' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
  error: string | null;
  metadata: Record<string, any>;
}

interface TaskStatus {
  enabled: boolean;
  remainingCount: number;
  totalCount: number;
  authorizedAt: string;
  lastInjectAt: string | null;
}

// ── Props ──

interface TaskStatusPanelProps {
  activeTasks: Task[];
  injectMessages: InjectMessage[];
  onConfirmInject: (msg: InjectMessage) => void;
  onClearTasks: () => void;
}

// ══════════════════════════════════════════════════════════════════
// AutoConfirmStatus — 自动确认授权
// ══════════════════════════════════════════════════════════════════

function AutoConfirmStatus() {
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [customCount, setCustomCount] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/inject/auto-confirm-status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // 静默
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, []);

  const authorize = async (count: number) => {
    try {
      await fetch('/api/inject/auto-confirm/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      await fetchStatus();

      // 授权后立即触发一次消费检查
      setTimeout(async () => {
        try {
          const res = await fetch('/api/inject/pending');
          if (res.ok) {
            const data = await res.json();
            if (data.pending?.length > 0) {
              console.log(`[AutoConfirm] Authorized, processing ${data.pending.length} pending messages`);
              window.dispatchEvent(new Event('inject-poll'));
            }
          }
        } catch {
          // 静默
        }
      }, 100);
    } catch {
      // 静默
    }
  };

  // 状态 1：无授权额度
  if (!status || (!status.enabled && status.remainingCount === 0)) {
    return (
      <div className="bg-gray-900/50 border-b border-gray-700/50 px-4 py-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">
              <Zap size={14} className="inline mr-1" />
              Agent 自主注入授权
            </span>
          </div>
          <div className="flex items-center gap-1">
            {[20, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => authorize(n)}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-primary-600 rounded text-gray-300 hover:text-white transition-colors"
              >
                {n} 轮
              </button>
            ))}
            {showCustom ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={customCount}
                  onChange={(e) => setCustomCount(e.target.value)}
                  placeholder="自定义"
                  className="w-16 text-xs px-1 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt(customCount, 10);
                      if (n >= 1 && n <= 1000) {
                        authorize(n);
                        setCustomCount('');
                        setShowCustom(false);
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const n = parseInt(customCount, 10);
                    if (n >= 1 && n <= 1000) {
                      authorize(n);
                      setCustomCount('');
                      setShowCustom(false);
                    }
                  }}
                  className="text-xs px-2 py-1 bg-primary-600 hover:bg-primary-500 rounded text-white"
                >
                  确认
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustom(true)}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors"
              >
                自定义
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 状态 2：有授权额度但未激活
  if (!status.enabled && status.remainingCount > 0) {
    return (
      <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-yellow-300">
              <Zap size={14} className="inline mr-1" />
              授权待确认
            </span>
            <span className="text-yellow-400 text-xs">
              额度 {status.remainingCount}/{status.totalCount} 次
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await fetch('/api/inject/auto-confirm/authorize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ count: status.remainingCount }),
                });
                await fetchStatus();
              }}
              className="text-xs px-2 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-yellow-100"
            >
              确认激活
            </button>
            <button
              onClick={async () => {
                await fetch('/api/inject/auto-confirm/cancel', { method: 'POST' });
                setStatus(null);
              }}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 状态 3：已激活
  return (
    <div className="bg-blue-900/30 border-b border-blue-700/50 px-4 py-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-blue-300">
            <Zap size={14} className="inline mr-1" />
            自动确认模式
          </span>
          <span className="text-blue-400 text-xs">
            剩余 {status.remainingCount}/{status.totalCount} 次
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status.lastInjectAt && (
            <span className="text-blue-500 text-xs">
              最近注入: {new Date(status.lastInjectAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={async () => {
              await fetch('/api/inject/auto-confirm/cancel', { method: 'POST' });
              setStatus(null);
            }}
            className="text-xs px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-red-100"
          >
            取消授权
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════

export default function TaskStatusPanel({
  activeTasks,
  injectMessages,
  onConfirmInject,
  onClearTasks,
}: TaskStatusPanelProps) {
  return (
    <>
      {/* 自动确认状态 */}
      <AutoConfirmStatus />

      {/* 活跃任务面板 */}
      {activeTasks.length > 0 && (
        <div className="bg-blue-900/30 border-b border-blue-700/50 px-4 py-2">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-blue-300 font-medium">
              📋 活跃任务 ({activeTasks.length})
            </span>
            <button
              onClick={onClearTasks}
              className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-blue-100"
            >
              清空
            </button>
          </div>
          <div className="space-y-1">
            {activeTasks.slice(0, 3).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-blue-200 truncate max-w-[70%]">
                  {task.content}
                </span>
                <span className={`px-2 py-0.5 rounded ${
                  task.status === 'pending' ? 'bg-yellow-700 text-yellow-100' :
                  task.status === 'received' ? 'bg-blue-700 text-blue-100' :
                  task.status === 'processing' ? 'bg-green-700 text-green-100' :
                  task.status === 'completed' ? 'bg-gray-700 text-gray-100' :
                  task.status === 'failed' ? 'bg-red-700 text-red-100' :
                  'bg-gray-700 text-gray-100'
                }`}>
                  {task.status === 'pending' ? '等待' :
                   task.status === 'received' ? '已接收' :
                   task.status === 'processing' ? '处理中' :
                   task.status === 'completed' ? '完成' :
                   task.status === 'failed' ? '失败' : '取消'}
                </span>
              </div>
            ))}
            {activeTasks.length > 3 && (
              <div className="text-xs text-blue-400">
                还有 {activeTasks.length - 3} 个任务...
              </div>
            )}
          </div>
        </div>
      )}

      {/* 注入消息通知栏 */}
      {injectMessages.length > 0 && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-4 py-2">
          {injectMessages.map((msg) => (
            <div
              key={msg.id}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-yellow-300">
                <Zap size={14} className="inline mr-1" />
                [{msg.source}] {msg.content}
              </span>
              <button
                onClick={() => onConfirmInject(msg)}
                className="text-xs px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-yellow-100 ml-2 shrink-0"
              >
                注入对话
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
