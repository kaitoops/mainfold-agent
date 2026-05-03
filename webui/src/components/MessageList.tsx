/**
 * MessageList — 消息列表 + 空状态 + 流式加载指示器
 *
 * 从 ChatPage.tsx 提取。
 * 内含 CollapsibleContent、ReasoningBlock、TokenBar 三个子组件。
 * 所有状态由父组件管理，通过 props 传入。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Copy, Check, Zap } from 'lucide-react';

// ── 类型 ──

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning_content?: string | null;
  timestamp: string;
  token_used?: number;
  senderModel?: string;
  images?: string[];
  _streaming?: boolean;
  tool_call_depth?: number;
  source?: 'user' | 'workbuddy' | 'system';
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: string;
}

interface AgentStatusEntry {
  phase: string;
  detail: string;
  timestamp: string;
}

interface AgentStatus {
  phase: 'idle' | 'api' | 'tool' | 'tool-result' | 'refactor' | 'finalizing';
  detail: string;
  toolName?: string;
  filePath?: string;
  timestamp: string;
  history: AgentStatusEntry[];
  elapsed: number;
}

// ── Props ──

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  agentStatus: AgentStatus | null;
  activeSession: Session | null;
  copiedId: string | null;
  onCopyMessage: (content: string, id: string) => void;
  onCreateSession: () => void;
  /** 滚动锚点 ref，由父组件管理以实现自动滚动 */
  messagesEndRef?: React.RefObject<HTMLDivElement | null>;
}

// ── Agent 阶段配置 ──

const AGENT_PHASE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  idle:       { label: '等待中',   color: 'bg-gray-500',  icon: '○' },
  api:        { label: '调用 AI',  color: 'bg-blue-400',  icon: '◉' },
  tool:       { label: '执行操作', color: 'bg-yellow-400', icon: '▶' },
  'tool-result': { label: '操作完成', color: 'bg-green-400', icon: '✓' },
  refactor:   { label: '优化输出', color: 'bg-purple-400', icon: '◎' },
  finalizing: { label: '生成回复', color: 'bg-indigo-400', icon: '◆' },
};

// ══════════════════════════════════════════════════════════════════
// 子组件：可折叠长内容
// ══════════════════════════════════════════════════════════════════

function CollapsibleContent({
  content,
  maxLength = 1000,
  className = '',
  label = '展开全部',
}: {
  content: string;
  maxLength?: number;
  className?: string;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > maxLength;
  const displayContent = expanded || !isLong ? content : content.slice(0, maxLength) + '...';

  if (!isLong) {
    return <div className={className}>{content}</div>;
  }

  return (
    <div>
      <div className={className}>{displayContent}</div>
      <button
        className="text-xs text-primary-400 hover:text-primary-300 mt-1 flex items-center gap-1"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <>
            <ChevronUp size={12} />
            <span>收起</span>
          </>
        ) : (
          <>
            <ChevronDown size={12} />
            <span>{label} ({content.length} 字)</span>
          </>
        )}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 子组件：推理折叠块
// ══════════════════════════════════════════════════════════════════

function ReasoningBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="reasoning-block">
      <button
        className="reasoning-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>推理过程</span>
      </button>
      {expanded && (
        <div className="text-gray-400 text-xs whitespace-pre-wrap mt-1">
          {content}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 子组件：Token 进度条
// ══════════════════════════════════════════════════════════════════

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

function TokenBar({ tokens }: { tokens: number }) {
  const maxTokens = 128000;
  const ratio = Math.min(tokens / maxTokens, 1);

  const color =
    ratio < 0.5
      ? 'bg-green-500'
      : ratio < 0.8
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span>{formatTokenCount(tokens)} tokens</span>
      <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════

export default function MessageList({
  messages,
  isLoading,
  agentStatus,
  activeSession,
  copiedId,
  onCopyMessage,
  onCreateSession,
  messagesEndRef,
}: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* 空状态：无活跃会话 */}
      {!activeSession && (
        <div className="flex items-center justify-center h-full text-gray-500">
          <div className="text-center">
            <Zap size={48} className="mx-auto mb-4 text-primary-600" />
            <p className="text-lg mb-2">Mainfold Agent</p>
            <p className="text-sm">流形导航 × MemPalace</p>
            <button
              onClick={onCreateSession}
              className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm transition-colors"
            >
              开始对话
            </button>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${
            msg.role === 'user' ? 'justify-end' : 'justify-start'
          }`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-3 ${
              msg.source === 'workbuddy'
                ? 'bg-blue-600 text-white border-2 border-blue-400'
                : msg.role === 'user'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-800 text-gray-200'
            }`}
          >
            {/* WorkBuddy 注入标识 */}
            {msg.source === 'workbuddy' && (
              <div className="text-xs text-blue-200 mb-1 font-medium">
                🤖 WorkBuddy 注入
              </div>
            )}

            {/* R1 推理过程 */}
            {msg.role === 'assistant' && msg.reasoning_content && (
              <ReasoningBlock content={msg.reasoning_content} />
            )}

            {/* 消息内容 */}
            {msg._streaming ? (
              <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
            ) : (
              <CollapsibleContent
                content={msg.content}
                maxLength={1000}
                className="whitespace-pre-wrap text-sm"
                label="展开全部"
              />
            )}

            {/* 元数据 */}
            {msg.role === 'assistant' && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
                {msg.token_used && <TokenBar tokens={msg.token_used} />}
                <button
                  onClick={() => onCopyMessage(msg.content, msg.id)}
                  className="text-gray-500 hover:text-gray-300 ml-auto"
                >
                  {copiedId === msg.id ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 流式加载指示器 */}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-gray-800 rounded-lg px-4 py-3 text-gray-400 text-sm max-w-[85%] min-w-[240px]">
            {/* 当前阶段指示器 */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                  agentStatus
                    ? (AGENT_PHASE_CONFIG[agentStatus.phase]?.color ?? 'bg-blue-400')
                    : 'bg-blue-400'
                }`}
              />
              <span className="font-medium text-gray-300">
                {agentStatus
                  ? (AGENT_PHASE_CONFIG[agentStatus.phase]?.label ?? '处理中')
                  : '处理中'}
              </span>
              {agentStatus && agentStatus.elapsed > 2 && (
                <span className="text-xs text-gray-600 ml-auto">
                  {agentStatus.elapsed < 60
                    ? `${agentStatus.elapsed}s`
                    : `${Math.floor(agentStatus.elapsed / 60)}m${agentStatus.elapsed % 60}s`}
                </span>
              )}
            </div>

            {/* 当前详情 */}
            <div className="text-xs text-gray-500">
              {agentStatus?.detail ?? '初始化...'}
            </div>

            {/* 文件路径（如有） */}
            {agentStatus?.filePath && (
              <div
                className="text-[11px] text-gray-600 mt-0.5 truncate font-mono"
                title={agentStatus.filePath}
              >
                {agentStatus.filePath.length > 70
                  ? '...' + agentStatus.filePath.slice(-67)
                  : agentStatus.filePath}
              </div>
            )}

            {/* 工具名（如有且非 read/write 已显示路径） */}
            {agentStatus?.toolName && agentStatus.phase === 'tool' && !agentStatus.filePath && (
              <div className="text-[11px] text-gray-600 mt-0.5">
                {agentStatus.toolName}
              </div>
            )}

            {/* 最近历史轨迹（最后 3 条，不含当前） */}
            {agentStatus && agentStatus.history.length > 1 && (
              <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-0.5">
                {agentStatus.history.slice(-4, -1).map((h, i) => (
                  <div key={i} className="text-[11px] text-gray-600 flex items-center gap-1">
                    <span className="text-gray-700">└</span>
                    <span>{h.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 滚动锚点 — 在滚动容器内部 */}
      <div ref={messagesEndRef} />
    </div>
  );
}
