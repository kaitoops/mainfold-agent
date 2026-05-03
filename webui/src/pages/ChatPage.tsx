/**
 * mainfold-agent WebUI — ChatPage（重构版）
 *
 * 基于 original ChatPage.tsx 拆分：
 *   改动1: SessionSidebar → components/SessionSidebar.tsx
 *   改动2: MessageList → components/MessageList.tsx
 *   改动3: InputBar → components/InputBar.tsx
 *   改动4: TaskStatusPanel → components/TaskStatusPanel.tsx
 *   改动5: AutoConfirmStatus → 移入 TaskStatusPanel
 *   改动6: CollapsibleContent/ReasoningBlock/TokenBar → 移入 MessageList
 *
 * 保留的原始逻辑：
 *   - 会话多标签管理 + localStorage 持久化
 *   - DeepSeek R1 reasoning_content 可折叠展示
 *   - WorkBuddy 注入轮询 + 确认消费
 *   - Token 用量进度条（绿→黄→红渐变）
 *   - 消息复制功能
 *   - 图片上传
 *   - Agent 实时状态轮询
 *   - 任务状态轮询
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import SessionSidebar from '../components/SessionSidebar';
import MessageList from '../components/MessageList';
import InputBar from '../components/InputBar';
import TaskStatusPanel from '../components/TaskStatusPanel';

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
  senderModel?: string;
  images?: string[];
  /** 流式输出标记：true 表示内容仍在逐 token 更新中 */
  _streaming?: boolean;
  /** 工具调用深度 */
  tool_call_depth?: number;
  /** 消息来源：'user' | 'workbuddy' | 'system' */
  source?: 'user' | 'workbuddy' | 'system';
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
  taskId: string | null;
  content: string;
  source: string;
  timestamp: string;
  priority: number;
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  context: string;
}

interface ModelsResponse {
  providers: Record<string, { models: ModelInfo[] }>;
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

async function loadSessionsFromBackend(): Promise<Session[]> {
  try {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      return data.sessions ?? [];
    }
  } catch {
    // 静默
  }
  return [];
}

async function saveSessionsToBackend(sessions: Session[]): Promise<void> {
  try {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions }),
    });
  } catch {
    // 静默
  }
}

// ══════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════

export default function ChatPage() {
  // ── 会话状态 ──
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => sessions[0]?.id ?? null,
  );

  // ── 输入状态 ──
  const [input, setInput] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);

  // ── 加载/轮询状态 ──
  const [isLoading, setIsLoading] = useState(false);
  const [injectMessages, setInjectMessages] = useState<InjectMessage[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentPollActive, setAgentPollActive] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);

  // ── Refs ──
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 当前活跃会话 ──
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // ══════════════════════════════════════════════════════════════
  // Effects
  // ══════════════════════════════════════════════════════════════

  // 持久化
  useEffect(() => {
    saveSessions(sessions);
    saveSessionsToBackend(sessions);
  }, [sessions]);

  // 启动时从后端加载
  useEffect(() => {
    loadSessionsFromBackend().then((backendSessions) => {
      if (backendSessions.length > 0) {
        setSessions((prev) => {
          const merged = new Map<string, Session>();
          for (const s of backendSessions) merged.set(s.id, s);
          for (const s of prev) {
            const existing = merged.get(s.id);
            if (!existing || s.messages.length > existing.messages.length) {
              merged.set(s.id, s);
            }
          }
          return Array.from(merged.values());
        });
      }
    });
  }, []);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId]);

  // 获取模型列表
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data: ModelsResponse = await res.json();
          const all: ModelInfo[] = [];
          for (const provider of Object.values(data.providers)) {
            all.push(...provider.models);
          }
          setAvailableModels(all);
        }
      } catch {
        // 静默
      }
    };
    fetchModels();
  }, []);

  // 注入轮询
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/inject/pending');
        if (res.ok) {
          const data = await res.json();
          if (data.pending?.length > 0) {
            const statusRes = await fetch('/api/inject/auto-confirm-status');
            const statusData = await statusRes.json();

            if (statusData.enabled && statusData.remainingCount > 0) {
              // 自动确认模式：静默消费
              for (const msg of data.pending) {
                await fetch(`/api/inject/pending/${msg.id}`, { method: 'DELETE' });
                if (msg.taskId) {
                  await fetch(`/api/tasks/${msg.taskId}/status`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'received' }),
                  });
                }
                setSessions((prevSessions) => {
                  let currentActive = prevSessions.find((s) => s.id === activeSessionId);
                  if (!currentActive) {
                    const newSession: Session = {
                      id: generateId(),
                      title: '自动创建会话',
                      messages: [],
                      model: DEFAULT_MODEL,
                      createdAt: new Date().toISOString(),
                    };
                    prevSessions = [newSession, ...prevSessions];
                    currentActive = newSession;
                    setTimeout(() => setActiveSessionId(newSession.id), 0);
                  }
                  const injectContent = msg.content;
                  setTimeout(async () => {
                    setIsLoading(true);
                    const history = (currentActive!.messages ?? []).map((m) => ({
                      role: m.role,
                      content: m.content,
                    }));
                    try {
                      const chatRes = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          message: injectContent,
                          model: currentActive!.model ?? DEFAULT_MODEL,
                          conversation_history: history,
                          session_id: currentActive!.id,
                          stream: true,
                        }),
                      });
                      if (!chatRes.ok) throw new Error(`API error: ${chatRes.status}`);
                      const assistantMsgId = generateId();
                      const reader = chatRes.body!.getReader();
                      const decoder = new TextDecoder();
                      let sseBuffer = '';
                      let streamContent = '';
                      let streamReasoning = '';
                      let streamTokenUsed = 0;
                      let streamTimestamp = '';
                      let streamDepth = 0;

                      setSessions((prev) =>
                        prev.map((s) =>
                          s.id === currentActive!.id
                            ? {
                                ...s,
                                messages: [
                                  ...s.messages,
                                  {
                                    id: assistantMsgId,
                                    role: 'assistant' as const,
                                    content: '',
                                    timestamp: new Date().toISOString(),
                                    senderModel: currentActive!.model ?? DEFAULT_MODEL,
                                    _streaming: true,
                                  },
                                ],
                              }
                            : s,
                        ),
                      );

                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        sseBuffer += decoder.decode(value, { stream: true });
                        const lines = sseBuffer.split('\n');
                        sseBuffer = lines.pop() || '';
                        let currentEvent = '';
                        for (const line of lines) {
                          if (line.startsWith('event: ')) {
                            currentEvent = line.slice(7).trim();
                            continue;
                          }
                          if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6).trim();
                            try {
                              const evt = JSON.parse(jsonStr);
                              const evtType = currentEvent || (evt.token_used !== undefined ? 'done' : evt.content && evt.accumulated !== undefined ? 'token' : 'unknown');
                              currentEvent = '';
                              if (evtType === 'token' || (evt.content && evt.accumulated !== undefined)) {
                                streamContent = evt.accumulated;
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.id === currentActive!.id
                                      ? {
                                          ...s,
                                          messages: s.messages.map((m) =>
                                            m.id === assistantMsgId
                                              ? { ...m, content: streamContent, _streaming: true }
                                              : m,
                                          ),
                                        }
                                      : s,
                                  ),
                                );
                              } else if (evtType === 'reasoning') {
                                streamReasoning = evt.accumulated || '';
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.id === currentActive!.id
                                      ? {
                                          ...s,
                                          messages: s.messages.map((m) =>
                                            m.id === assistantMsgId
                                              ? { ...m, reasoning_content: streamReasoning }
                                              : m,
                                          ),
                                        }
                                      : s,
                                  ),
                                );
                              } else if (evtType === 'tool_call') {
                                streamDepth = evt.depth || 0;
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.id === currentActive!.id
                                      ? {
                                          ...s,
                                          messages: s.messages.map((m) =>
                                            m.id === assistantMsgId
                                              ? { ...m, tool_call_depth: streamDepth }
                                              : m,
                                          ),
                                        }
                                      : s,
                                  ),
                                );
                              } else if (evtType === 'done') {
                                streamTokenUsed = evt.token_used || 0;
                                streamTimestamp = evt.timestamp || new Date().toISOString();
                                setSessions((prev) =>
                                  prev.map((s) =>
                                    s.id === currentActive!.id
                                      ? {
                                          ...s,
                                          messages: s.messages.map((m) =>
                                            m.id === assistantMsgId
                                              ? {
                                                  ...m,
                                                  content: streamContent || m.content,
                                                  reasoning_content: streamReasoning || m.reasoning_content,
                                                  token_used: streamTokenUsed,
                                                  timestamp: streamTimestamp,
                                                  _streaming: false,
                                                  tool_call_depth: streamDepth,
                                                }
                                              : m,
                                          ),
                                        }
                                      : s,
                                  ),
                                );
                              }
                            } catch {
                              // 忽略
                            }
                          }
                        }
                      }
                    } catch (err) {
                      console.error('[AutoConfirm] SSE error:', err);
                    } finally {
                      setIsLoading(false);
                    }
                  }, 0);
                  return prevSessions;
                });
              }
            } else {
              setInjectMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const newMsgs = data.pending.filter(
                  (m: InjectMessage) => !existingIds.has(m.id),
                );
                return [...prev, ...newMsgs];
              });
            }
          }
        }
      } catch {
        // 静默
      }
    };

    const id = setInterval(poll, INJECT_POLL_INTERVAL);
    const handleInjectPoll = () => poll();
    window.addEventListener('inject-poll', handleInjectPoll);
    return () => {
      clearInterval(id);
      window.removeEventListener('inject-poll', handleInjectPoll);
    };
  }, [activeSessionId]);

  // Agent 状态轮询
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
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      clearInterval(id);
      setAgentStatus(null);
    };
  }, [isLoading]);

  // 任务状态轮询
  useEffect(() => {
    const pollTasks = async () => {
      try {
        const res = await fetch('/api/tasks');
        if (res.ok) {
          const data = await res.json();
          setActiveTasks(data.tasks || []);
        }
      } catch {
        // 静默
      }
    };
    pollTasks();
    const id = setInterval(pollTasks, 5000);
    return () => clearInterval(id);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // Handlers
  // ══════════════════════════════════════════════════════════════

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

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        const next = sessions.find((s) => s.id !== sessionId);
        setActiveSessionId(next?.id ?? null);
      }
    },
    [activeSessionId, sessions],
  );

  const copyMessage = useCallback(async (content: string, msgId: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const confirmInject = useCallback(async (msg: InjectMessage) => {
    try {
      await fetch(`/api/inject/pending/${msg.id}`, { method: 'DELETE' });
      setInjectMessages((prev) => prev.filter((m) => m.id !== msg.id));

      if (msg.taskId) {
        await fetch(`/api/tasks/${msg.taskId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'received' }),
        });
      }

      if (!activeSession) return;

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

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      const assistantMsgWithModel: Message = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        reasoning_content: data.reasoning_content,
        timestamp: data.timestamp,
        token_used: data.token_used,
        senderModel: currentSession?.model ?? DEFAULT_MODEL,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, assistantMsgWithModel] }
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
      if (msg.taskId) {
        try {
          // 捕获 AI 输出作为任务结果
          const taskResult = streamContent ? streamContent.slice(0, 500) : '任务已完成';
          await fetch(`/api/tasks/${msg.taskId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              status: 'completed',
              result: taskResult,
            }),
          });
        } catch {
          // 静默
        }
      }
    }
  }, [activeSession, sessions]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

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

    const textContent = input.trim();
    const images = [...uploadedImages];
    const hasImages = images.length > 0;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: textContent,
      timestamp: new Date().toISOString(),
      images: hasImages ? images : undefined,
    };

    const sessionId = session.id;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: [...s.messages, userMsg],
              title: s.messages.length === 0 ? (textContent || '(图片)').slice(0, 30) : s.title,
            }
          : s,
      ),
    );
    setInput('');
    setUploadedImages([]);
    setIsLoading(true);

    try {
      const currentSession = sessions.find((s) => s.id === sessionId);
      const history = (currentSession?.messages ?? []).map((m) => {
        if (m.role === 'user' && m.images && m.images.length > 0) {
          const parts: Record<string, unknown>[] = [];
          if (m.content) parts.push({ type: 'text', text: m.content });
          m.images.forEach((url) => {
            parts.push({ type: 'image_url', image_url: { url } });
          });
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      });

      let messagePayload: string | Record<string, unknown>[];
      if (hasImages) {
        const parts: Record<string, unknown>[] = [];
        if (textContent) parts.push({ type: 'text', text: textContent });
        images.forEach((url) => {
          parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
        });
        messagePayload = parts;
      } else {
        messagePayload = textContent;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messagePayload,
          model: currentSession?.model ?? DEFAULT_MODEL,
          conversation_history: history,
          session_id: sessionId,
          stream: true,
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      // ── SSE 流式接收 ──
      const assistantMsgId = generateId();
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let streamContent = '';
      let streamReasoning = '';
      let streamTokenUsed = 0;
      let streamTimestamp = '';
      let streamDepth = 0;

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: assistantMsgId,
                    role: 'assistant' as const,
                    content: '',
                    timestamp: new Date().toISOString(),
                    senderModel: currentSession?.model ?? DEFAULT_MODEL,
                    _streaming: true,
                  },
                ],
              }
            : s,
        ),
      );

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';
          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              try {
                const evt = JSON.parse(jsonStr);
                const evtType = currentEvent || (evt.token_used !== undefined ? 'done' : evt.content && evt.accumulated !== undefined ? 'token' : 'unknown');
                currentEvent = '';

                if (evtType === 'token' || (evt.content && evt.accumulated !== undefined)) {
                  streamContent = evt.accumulated;
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? { ...m, content: streamContent, _streaming: true }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                } else if (evt.tool_calls) {
                  const toolInfo = evt.tool_calls.map((tc: { name: string }) => tc.name).join(', ');
                  streamContent += `\n\n🔧 调用工具: ${toolInfo}\n\n`;
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? { ...m, content: streamContent, _streaming: true }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                } else if (evt.tool_start) {
                  streamContent += `⏳ ${evt.tool_name || evt.name}...\n`;
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? { ...m, content: streamContent, _streaming: true }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                } else if (evt.tool_result) {
                  streamContent += `✅ ${evt.name} 完成\n`;
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? { ...m, content: streamContent, _streaming: true }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                } else if (evt.token_used !== undefined) {
                  streamTokenUsed = evt.token_used || 0;
                  streamTimestamp = evt.timestamp || new Date().toISOString();
                  streamDepth = evt.tool_call_depth || 0;
                  streamReasoning = evt.reasoning_content || '';
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? {
                                    ...m,
                                    content: streamContent,
                                    reasoning_content: streamReasoning,
                                    timestamp: streamTimestamp,
                                    token_used: streamTokenUsed,
                                    tool_call_depth: streamDepth,
                                    _streaming: false,
                                  }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                } else if (evt.error) {
                  streamContent = `[错误] ${evt.error}`;
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === sessionId
                        ? {
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === assistantMsgId
                                ? { ...m, content: streamContent, _streaming: false }
                                : m,
                            ),
                          }
                        : s,
                    ),
                  );
                }
              } catch {
                // 忽略非 JSON 行
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
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
  }, [input, isLoading, activeSession, sessions, uploadedImages]);

  // ── 图片上传 ──

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setUploadedImages((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const removeImage = useCallback((index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ══════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="flex h-full">
      {/* 左侧：会话列表 */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
      />

      {/* 右侧：主聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部状态栏 */}
        <TaskStatusPanel
          activeTasks={activeTasks}
          injectMessages={injectMessages}
          onConfirmInject={confirmInject}
          onClearTasks={() => setActiveTasks([])}
        />

        {/* 消息列表（内含滚动锚点 ref） */}
        <MessageList
          messages={activeSession?.messages ?? []}
          isLoading={isLoading}
          agentStatus={agentStatus}
          activeSession={activeSession}
          copiedId={copiedId}
          onCopyMessage={copyMessage}
          onCreateSession={createSession}
          messagesEndRef={messagesEndRef}
        />

        {/* 底部输入框 */}
        {activeSession && (
          <InputBar
            input={input}
            onInputChange={setInput}
            isLoading={isLoading}
            onSendMessage={sendMessage}
            inputRef={inputRef}
            fileInputRef={fileInputRef}
            uploadedImages={uploadedImages}
            onImageSelect={handleImageSelect}
            onRemoveImage={removeImage}
          />
        )}
      </div>
    </div>
  );
}
