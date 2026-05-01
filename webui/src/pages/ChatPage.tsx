/**
 * mainfold-agent WebUI — ChatPage
 *
 * 基于 Hermes ChatPage.tsx 重写（用户原创代码）：
 *   改动1: STORAGE_KEY → 'mainfold_sessions'
 *   改动2: 默认模型 → 'deepseek-v4-flash'
 *   改动3: 项目名 → mainfold-agent
 *   改动4: 注入轮询对接新 /api/inject/pending
 *
 * 保留的原始逻辑（经审查确认正确）：
 *   - 会话多标签管理 + localStorage 持久化
 *   - DeepSeek R1 reasoning_content 可折叠展示
 *   - WorkBuddy 注入轮询 + 确认消费
 *   - Token 用量进度条（绿→黄→红渐变）
 *   - 消息复制功能
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Plus,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Zap,
  Trash2,
} from 'lucide-react';

// ── 常量 ──

const STORAGE_KEY = 'mainfold_sessions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const INJECT_POLL_INTERVAL = 3000;

// ── 类型 ──

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning_content?: string | null;
  timestamp: string;
  token_used?: number;
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: string;
}

interface InjectMessage {
  id: string;
  content: string;
  source: string;
  timestamp: string;
  priority: number;
}

// ── Agent 实时状态类型 ──

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

const AGENT_PHASE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  idle:       { label: '等待中',   color: 'bg-gray-500',  icon: '○' },
  api:        { label: '调用 AI',  color: 'bg-blue-400',  icon: '◉' },
  tool:       { label: '执行操作', color: 'bg-yellow-400', icon: '▶' },
  'tool-result': { label: '操作完成', color: 'bg-green-400', icon: '✓' },
  refactor:   { label: '优化输出', color: 'bg-purple-400', icon: '◎' },
  finalizing: { label: '生成回复', color: 'bg-indigo-400', icon: '◆' },
};

// ── 辅助函数 ──

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

// ── 推理折叠块 ──

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

// ── Token 进度条 ──

function TokenBar({ tokens }: { tokens: number }) {
  // 假设128K上下文窗口
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

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => sessions[0]?.id ?? null,
  );
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [injectMessages, setInjectMessages] = useState<InjectMessage[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentPollActive, setAgentPollActive] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── 会话持久化 ──

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // ── 自动滚动 ──

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId]);

  // ── 注入轮询 ──

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/inject/pending');
        if (res.ok) {
          const data = await res.json();
          if (data.pending?.length > 0) {
            setInjectMessages((prev) => {
              // 去重合并
              const existingIds = new Set(prev.map((m) => m.id));
              const newMsgs = data.pending.filter(
                (m: InjectMessage) => !existingIds.has(m.id),
              );
              return [...prev, ...newMsgs];
            });
          }
        }
      } catch {
        // 静默
      }
    };

    const id = setInterval(poll, INJECT_POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // ── Agent 状态轮询（仅 loading 时启动，1 秒间隔）──

  useEffect(() => {
    if (!isLoading) {
      setAgentPollActive(false);
      return;
    }

    setAgentPollActive(true);

    const poll = async () => {
      try {
        const res = await fetch('/api/agent/status');
        if (res.ok) {
          const data: AgentStatus = await res.json();
          setAgentStatus(data);
        }
      } catch {
        // 静默
      }
    };

    poll(); // 立即执行第一次
    const id = setInterval(poll, 1000);
    return () => {
      clearInterval(id);
      setAgentStatus(null);
    };
  }, [isLoading]);

  // ── 当前会话 ──

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // ── 新建会话 ──

  const createSession = useCallback(() => {
    const newSession: Session = {
      id: generateId(),
      title: '新对话',
      messages: [],
      model: DEFAULT_MODEL,
      createdAt: new Date().toISOString(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    inputRef.current?.focus();
  }, []);

  // ── 删除会话 ──

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(sessions.find((s) => s.id !== sessionId)?.id ?? null);
      }
    },
    [activeSessionId, sessions],
  );

  // ── 发送消息 ──

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    // 自动创建会话
    let session = activeSession;
    if (!session) {
      const newSession: Session = {
        id: generateId(),
        title: input.slice(0, 30),
        messages: [],
        model: DEFAULT_MODEL,
        createdAt: new Date().toISOString(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      session = newSession;
    }

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    // 添加用户消息
    const sessionId = session.id;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: [...s.messages, userMsg],
              title: s.messages.length === 0 ? input.trim().slice(0, 30) : s.title,
            }
          : s,
      ),
    );
    setInput('');
    setIsLoading(true);

    try {
      // 构建对话历史
      const currentSession = sessions.find((s) => s.id === sessionId);
      const history = (currentSession?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.trim(),
          model: currentSession?.model ?? DEFAULT_MODEL,
          conversation_history: history,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        reasoning_content: data.reasoning_content,
        timestamp: data.timestamp,
        token_used: data.token_used,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, assistantMsg] }
            : s,
        ),
      );
    } catch (err) {
      const errorMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `[错误] ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, errorMsg] }
            : s,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, activeSession, sessions]);

  // ── 确认注入消息 → 自动触发 AI 响应 ──

  const confirmInject = useCallback(async (msg: InjectMessage) => {
    try {
      // 1. 队列消费
      await fetch(`/api/inject/pending/${msg.id}`, { method: 'DELETE' });
      setInjectMessages((prev) => prev.filter((m) => m.id !== msg.id));

      if (!activeSession) return;

      // 2. 注入内容作为用户消息入会话
      const injectContent = `[外部注入 · ${msg.source}] ${msg.content}`;
      const injectMsg: Message = {
        id: generateId(),
        role: 'user',
        content: injectContent,
        timestamp: new Date().toISOString(),
      };
      const sessionId = activeSession.id;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, injectMsg] }
            : s,
        ),
      );

      // 3. 自动触发 AI 响应
      setIsLoading(true);

      const currentSession = sessions.find((s) => s.id === sessionId);
      const history = (currentSession?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: injectContent,
          model: currentSession?.model ?? DEFAULT_MODEL,
          conversation_history: history,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        reasoning_content: data.reasoning_content,
        timestamp: data.timestamp,
        token_used: data.token_used,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, assistantMsg] }
            : s,
        ),
      );
    } catch (err) {
      // 错误 → 在会话中显示错误消息
      const errorMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: `[错误] ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      if (activeSession) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, messages: [...s.messages, errorMsg] }
              : s,
          ),
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeSession, sessions]);

  // ── 复制消息 ──

  const copyMessage = useCallback(async (content: string, msgId: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // ── 键盘事件 ──

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  return (
    <div className="flex h-full">
      {/* ── 左侧会话列表 ── */}
      <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-800">
          <button
            onClick={createSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm transition-colors"
          >
            <Plus size={16} />
            新对话
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                activeSessionId === session.id
                  ? 'bg-primary-600/20 text-primary-300'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <span className="flex-1 truncate">{session.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── 主聊天区 ── */}
      <div className="flex-1 flex flex-col min-w-0">
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
                  onClick={() => confirmInject(msg)}
                  className="text-xs px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-yellow-100 ml-2"
                >
                  注入对话
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!activeSession && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Zap size={48} className="mx-auto mb-4 text-primary-600" />
                <p className="text-lg mb-2">Mainfold Agent</p>
                <p className="text-sm">流形导航 × MemPalace</p>
                <button
                  onClick={createSession}
                  className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm transition-colors"
                >
                  开始对话
                </button>
              </div>
            </div>
          )}

          {activeSession?.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-800 text-gray-200'
                }`}
              >
                {/* R1 推理过程 */}
                {msg.role === 'assistant' && msg.reasoning_content && (
                  <ReasoningBlock content={msg.reasoning_content} />
                )}

                {/* 消息内容 */}
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>

                {/* 元数据 */}
                {msg.role === 'assistant' && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
                    {msg.token_used && <TokenBar tokens={msg.token_used} />}
                    <button
                      onClick={() => copyMessage(msg.content, msg.id)}
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
                  <div className="text-[11px] text-gray-600 mt-0.5 truncate font-mono"
                    title={agentStatus.filePath}>
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

          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        {activeSession && (
          <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
            <div className="flex gap-3 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-primary-500 transition-colors"
                rows={1}
                style={{ minHeight: '44px', maxHeight: '120px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
