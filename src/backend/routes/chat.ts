/**
 * mainfold-agent — Chat 路由模块 (M3)
 *
 * 运行逻辑提取自 G:/Hermes/webui/backend/app/main.py
 * 旧代码 FastAPI /api/chat + /api/health + /api/models
 *
 * 旧代码根因问题：
 *   ChatRequest 只有 {message, model, conversation_history}
 *   → 没有 system_prompt 字段
 *   → messages 里没有 system role 消息
 *   → DeepSeek API 以默认身份响应
 *   → Agent 不知道自己是 mainfold-agent
 *
 * 旧代码运行逻辑（/api/chat）：
 *   1. 构建 messages：从 conversation_history 映射 role + 追加当前 user message
 *   2. 解析 provider：deepseek/siliconflow/openrouter
 *   3. 标准化模型名：DEEPSEEK_MODEL_ALIASES
 *   4. 构建 HTTP 请求到对应 API
 *   5. 返回 ChatResponse {content, token_used, timestamp, reasoning_content}
 *
 * 重构差异：
 * - 旧代码不注入 system_prompt → 新代码 M1+M2 保证身份，M3 强制注入
 * - 旧代码支持多 provider → 新代码只保留 DeepSeek（简化，其他 provider 需要时再加）
 * - 旧代码 FastAPI+httpx → 新代码 Express+fetch（Node.js 原生）
 * - 旧代码模型别名映射 → 新代码精简映射表
 * - 新代码每轮对话后更新 TRI-State（M4 耦合）
 * - 新代码每轮对话后 ping 健康监控（M5 耦合）
 *
 * 关键耦合：
 * - M1(soul-loader) → 提供 systemPrompt
 * - M2(identity-assert) → 保证身份正确后才允许 chat
 * - M4(tri-state) → onChatComplete() 更新状态
 * - M5(health-signal) → ping() 维持心跳
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { TriStateOrchestrator } from '../tri-state.js';
import type { HealthMonitor } from '../health-signal.js';
import type { ColdMemory } from '../memory/cold-db.js';

// ── 模型配置 ──

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const TOOLS_BASE_URL = process.env.TOOLS_BASE_URL || 'http://127.0.0.1:8000';

/** 模型别名映射（运行逻辑等同旧 DEEPSEEK_MODEL_ALIASES，精简版） */
const MODEL_ALIASES: Record<string, string> = {
  'deepseek-ai/DeepSeek-R1': 'deepseek-reasoner',
  'deepseek/deepseek-r1': 'deepseek-reasoner',
  'deepseek-r1': 'deepseek-reasoner',
  'deepseek-ai/DeepSeek-V3': 'deepseek-v4-flash',
  'deepseek-ai/DeepSeek-V3.2': 'deepseek-v4-flash',
  'deepseek/deepseek-v3': 'deepseek-v4-flash',
  'deepseek/deepseek-v3.2': 'deepseek-v4-flash',
  'deepseek-v3': 'deepseek-v4-flash',
  'deepseek-v3.2': 'deepseek-v4-flash',
};

function normalizeModelName(modelId: string): string {
  return MODEL_ALIASES[modelId] ?? modelId;
}

// ── 请求/响应模型 ──

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  model: z.string().default('deepseek-v4-flash'),
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']).default('user'),
    content: z.string(),
  })).default([]),
  session_id: z.string().optional(),
  /** Function calling: DeepSeek 工具定义 */
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.unknown()),
    }),
  })).optional(),
  /** Function calling: tool_choice 策略 */
  tool_choice: z.union([z.literal('auto'), z.literal('none'), z.literal('required')]).optional(),
});

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  /** Function calling: assistant message 中的 tool_calls（回传 DeepSeek 时需要） */
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface DeepSeekApiMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
}

interface DeepSeekApiResponse {
  choices: Array<{
    message: DeepSeekApiMessage;
    finish_reason: string;
  }>;
  usage?: { total_tokens: number };
}

// ── 工具执行辅助 ──

/** 通过 HTTP 调用本地工具端点 */
async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  let parsedArgs: Record<string, unknown> = {};
  try {
    parsedArgs = JSON.parse(argsStr);
  } catch {
    return JSON.stringify({ error: `Invalid tool arguments JSON: ${argsStr}` });
  }

  // 将工具名映射到本地端点
  const endpointMap: Record<string, string> = {
    exec: '/api/tools/exec',
    'read-file': '/api/tools/read-file',
    'write-file': '/api/tools/write-file',
    ls: '/api/tools/ls',
    git: '/api/tools/git',
    http: '/api/tools/http',
  };

  const endpoint = endpointMap[name];
  if (!endpoint) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  try {
    const response = await fetch(`${TOOLS_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedArgs),
    });
    const result = await response.json();
    return JSON.stringify(result);
  } catch (err) {
    const error = err as Error;
    return JSON.stringify({ error: `Tool execution failed: ${error.message}` });
  }
}

/** Function calling 最大循环深度 */
const MAX_TOOL_CALL_DEPTH = 10;

// ── Chat 路由器 ──

export function createChatRouter(deps: {
  systemPrompt: string;
  triState: TriStateOrchestrator;
  healthMonitor: HealthMonitor;
  apiKey: string;
  getSeedContext?: () => string;
  /** 收到 [心流] 前缀消息时调用的入库回调 */
  seedFlowCb?: (content: string) => void;
  /** Phase E: 冷记忆自动日志（可选） */
  coldMemory?: ColdMemory;
}): Router {
  const router = Router();
  const { systemPrompt, triState, healthMonitor, apiKey, getSeedContext } = deps;

  // ── POST /api/chat ──

  router.post('/api/chat', async (req: Request, res: Response) => {
    try {
      // 1. 验证请求（运行逻辑等同旧 ChatRequest Pydantic 验证）
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }
      const { message, model, conversation_history, session_id } = parsed.data;

      // 2. 心流种子自动入库
      // 如果消息以 [心流] 开头，自动入库到 KnowledgeGraph
      const flowPrefix = '[心流]';
      const rawMessage = message;
      let cleanedMessage = rawMessage;
      if (rawMessage.startsWith(flowPrefix) && deps.seedFlowCb) {
        const flowContent = rawMessage.slice(flowPrefix.length).trim();
        if (flowContent) {
          deps.seedFlowCb(flowContent);
          console.log(`[chat] Auto-seeded: ${flowContent.slice(0, 50)}...`);
          cleanedMessage = `[心流] ${flowContent}`;
        }
      }

      // 3. 构建 system prompt（含动态种子上下文）
      const seedContext = getSeedContext ? getSeedContext() : '';
      const fullSystemPrompt = seedContext
        ? `${systemPrompt}\n\n${seedContext}`
        : systemPrompt;

      // 【根因修复】：注入 system_prompt 作为第一条消息
      const systemMsg: ChatMessage = {
        role: 'system',
        content: fullSystemPrompt,
      };
      const historyMsgs: ChatMessage[] = conversation_history.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const userMsg: ChatMessage = { role: 'user', content: cleanedMessage };

      const allMessages: ChatMessage[] = [systemMsg, ...historyMsgs, userMsg];

      // 4. 标准化模型名
      const normalizedModel = normalizeModelName(model);

      // 5. 检查 API Key
      if (!apiKey) {
        res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });
        return;
      }

      // ══════════════════════════════════════════════════════════════════
      // Function Calling 循环
      // ══════════════════════════════════════════════════════════════════
      // 流程：
      //   ① 发消息给 DeepSeek（含 tools 定义）
      //   ② 如果返回 tool_calls → 执行工具 → 追加结果 → 回到 ①
      //   ③ 如果返回普通 content → 返回给前端
      //   ④ 最大深度保护（MAX_TOOL_CALL_DEPTH）

      // 使用松散类型存储 messages，以支持 DeepSeek 的额外字段（如 reasoning_content）
      // strict ChatMessage 会导致 reasoning_content、tool_calls 等字段在 JSON.stringify 时丢失
      const workingMessages: Record<string, unknown>[] = [...allMessages] as unknown as Record<string, unknown>[];
      let finalContent = '';
      let finalReasoning: string | null = null;
      let totalTokens = 0;
      let toolCallDepth = 0;

      // 构建 tools 参数（如果有）
      const requestTools = parsed.data.tools;
      const requestToolChoice = parsed.data.tool_choice;

      while (toolCallDepth < MAX_TOOL_CALL_DEPTH) {
        toolCallDepth++;

        // 构建 API 请求体
        const apiRequestBody: Record<string, unknown> = {
          model: normalizedModel,
          messages: workingMessages,
          stream: false,
        };
        // 第一轮才携带 tools（后续轮次是 tool 结果回传，不需要再传 tools）
        if (toolCallDepth === 1 && requestTools && requestTools.length > 0) {
          apiRequestBody.tools = requestTools as Record<string, unknown>[];
          if (requestToolChoice) {
            apiRequestBody.tool_choice = requestToolChoice;
          }
          // thinking mode 兼容：通过保留原始 response message 的 reasoning_content 字段
          // 在 tool_calls 循环中自动回传，无需禁用 thinking mode
        }

        const apiResponse = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(apiRequestBody),
        });

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          console.error(`[chat] DeepSeek API error: ${apiResponse.status} ${errorText}`);
          res.status(apiResponse.status).json({ error: `API error: ${errorText}` });
          return;
        }

        const data = (await apiResponse.json()) as DeepSeekApiResponse;
        const choice = data.choices[0]?.message;
        const reason = data.choices[0]?.finish_reason || '';

        totalTokens += data.usage?.total_tokens || 0;

        // 检查是否有 tool_calls
        if (choice?.tool_calls && choice.tool_calls.length > 0 && reason === 'tool_calls') {
          // 使用原始 response message 对象（包含 reasoning_content 等所有字段）
          // DeepSeek thinking mode 要求 assistant message 必须携带 reasoning_content 回传
          // 如果用 ChatMessage 类型会丢失该字段，导致 API 拒绝
          const assistantRaw = choice as unknown as Record<string, unknown>;
          workingMessages.push(assistantRaw);

          // 执行每个 tool call
          for (const tc of choice.tool_calls) {
            console.log(`[chat] Tool call #${toolCallDepth}: ${tc.function.name}(${tc.function.arguments})`);

            // 执行工具
            const toolResult = await executeToolCall(tc);

            // 添加 tool 结果消息（DeepSeek API 需要 tool_call_id 来关联）
            workingMessages.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: tc.id,
            });
          }

          // 继续循环（让 DeepSeek 处理 tool 结果）
          continue;
        }

        // 普通内容响应
        finalContent = choice?.content || '';
        finalReasoning = choice?.reasoning_content || null;
        break; // 退出循环
      }

      // 如果达到最大深度但仍未得到最终回复，返回警告
      if (toolCallDepth >= MAX_TOOL_CALL_DEPTH && !finalContent) {
        finalContent = `[工具调用达到最大深度 ${MAX_TOOL_CALL_DEPTH} 层，自动终止。请简化请求或重试。]`;
      }

      // 6. 更新 TRI-State（M4 耦合）
      const triSnapshot = triState.onChatComplete(true);

      // 7. Ping 健康监控（M5 耦合）
      healthMonitor.ping();

      // 7.5 Phase E: 记录对话到冷记忆（可选）
      if (deps.coldMemory && cleanedMessage && finalContent) {
        try {
          deps.coldMemory.logConversation({
            session_id: session_id ?? null,
            user_message: cleanedMessage.slice(0, 1000),
            assistant_message: finalContent.slice(0, 2000),
            model: normalizedModel,
            token_used: totalTokens,
            tool_call_depth: toolCallDepth,
            reasoning_used: finalReasoning !== null,
          });
        } catch (err) {
          // 日志失败不阻塞主流程
          console.error(`[chat] Cold memory log failed: ${(err as Error).message}`);
        }
      }

      // 8. 返回
      res.json({
        content: finalContent,
        token_used: totalTokens,
        timestamp: new Date().toISOString(),
        reasoning_content: finalReasoning,
        tool_calls_used: toolCallDepth > 1,
        tool_call_depth: toolCallDepth,
        tri_state: {
          A: triSnapshot.A,
          S: triSnapshot.S,
          H: triSnapshot.H,
          triScore: triSnapshot.triScore,
          state: triSnapshot.state,
        },
      });

    } catch (err) {
      const error = err as Error;
      console.error(`[chat] Unhandled error: ${error.message}`);

      // 通知 TRI: 错误信号
      triState.signal('error');
      triState.onChatComplete(false);

      res.status(500).json({ error: error.message });
    }
  });

  // ── GET /api/models ──
  // 运行逻辑等同旧 /api/models：返回可用模型列表

  router.get('/api/models', (_req: Request, res: Response) => {
    res.json({
      providers: {
        deepseek: {
          models: [
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '1M上下文 · 强大推理', context: '1M' },
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: '1M上下文 · 快速响应', context: '1M' },
            { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: '128K上下文 · 深度推理', context: '128K' },
          ],
        },
      },
    });
  });

  return router;
}
