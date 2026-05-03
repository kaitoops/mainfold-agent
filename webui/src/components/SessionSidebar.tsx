/**
 * SessionSidebar — 左侧会话列表面板
 *
 * 从 ChatPage.tsx 提取，纯展示组件。
 * 所有状态由父组件管理，通过 props 传入。
 */

import { Plus, Trash2 } from 'lucide-react';

// ── 类型（与 ChatPage 共享结构） ──

interface Session {
  id: string;
  title: string;
  messages: unknown[];
  model: string;
  createdAt: string;
}

// ── Props ──

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
}

// ── 组件 ──

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      {/* 新建对话按钮 */}
      <div className="p-3 border-b border-gray-800">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm transition-colors"
        >
          <Plus size={16} />
          新对话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
              activeSessionId === session.id
                ? 'bg-primary-600/20 text-primary-300'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="flex-1 truncate">{session.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
