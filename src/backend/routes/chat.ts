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
import * as fs from 'fs';
import * as path from 'path';
import type { TriStateOrchestrator } from '../tri-state.js';
import type { HealthMonitor } from '../health-signal.js';
import type { ColdMemory } from '../memory/cold-db.js';

// ── ESA: 具身自注意力认知架构 ──

import { ESACore, getEsaToolDefinitions } from '../esa-core.js';

// ── Self-Scan: 自代码自省工具 ──

import { getSelfScanToolDefinition } from './self-scan.js';

// ── Phase 1: 输出重构器 prompt ──

const REFINER_PROMPT = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '../refiner-prompt.txt'), 'utf-8');
  } catch {
    console.warn('[chat] refiner-prompt.txt not found, output refactoring disabled');
    return '';
  }
})();

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

  // ── 本地工具（ESA 自注意力状态 + Self-Scan 代码自省）──

  if (name === 'esa_status' || name === 'esa_focus' || name === 'esa_anchor') {
    const { executeEsaTool } = await import('../esa-core.js');
    return executeEsaTool({ name, arguments: parsedArgs });
  }

  if (name === 'self_scan') {
    const { executeSelfScan } = await import('./self-scan.js');
    return executeSelfScan(parsedArgs as { action: string; filePath?: string; query?: string });
  }

  // 兼容：AI 可能自然推断出 read-file / read_file 作为独立工具名
  // 根据路径类型分流：
  //   绝对路径 → 路由到 tools 路由（受安全白名单控制，可读外部文件）
  //   相对路径 → 路由到 self-scan（只读 mainfold-agent 自身代码库）
  if (name === 'read-file' || name === 'read_file') {
    const filePath = (parsedArgs.filePath || parsedArgs.file || '') as string;
    if (path.isAbsolute(filePath)) {
      const endpoint = '/api/tools/read-file';
      const response = await fetch(`${TOOLS_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      const result = await response.json();
      return JSON.stringify(result);
    }
    const { executeSelfScan } = await import('./self-scan.js');
    return executeSelfScan({
      action: 'read-file',
      filePath,
    });
  }

  // ── HTTP 代理工具（由 tools 路由处理后端逻辑）──

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

// ── Phase 1: 输出重构器 ──

/** 内部术语列表：检测到这些词出现在最终回复中时触发重构 */
const INTERNAL_TERMS = [
  '流形导航', '流形坐标', '流形识别', '测地线', '测地线规划',
  '锚点', '五锚点', '叙事归属', '信息服务者锚点', '弱之道锚点',
  'Lie代数', 'L0', 'L1', 'L2', '元层', '熵力',
  '旋转采样', '维度投影', '局部曲率',
  'SOUL.md', 'MemPalace', 'TRI-State', 'BPS', 'ESAC',
  'DORMANT', '微快照', '心流令牌', '回响令牌',
] as const;

/** 元解释检测正则：Agent 在回复中暴露自己的思考过程 */
const META_EXPLAIN_RE = /我(错误|犯|修正|标记|不再|将[^]{1,20}(标记|暂存|激活))/;

/** 前缀解释检测正则：以"你提出"、"我理解"等开头 */
const PREFIX_EXPLAIN_RE = /^(你(提出|提到|说|的)|我(理解|知道|看到))/;

/**
 * 输出重构器
 * 检测 finalContent 是否含内部术语或元解释，若是则调用 V4-Flash 精炼。
 * 原始版本装入 reasoning_content，对外暴露精炼版本。
 *
 * 仅在非 function-calling 的最终回复生效（toolCallDepth === 1）。
 */
async function refactorOutput(
  rawContent: string,
  originalReasoning: string | null,
  apiKey: string,
  deepseekBase: string,
): Promise<{ content: string; reasoning: string }> {
  if (!REFINER_PROMPT) {
    // refiner-prompt.txt 未加载成功 → 直接透传
    return { content: rawContent, reasoning: originalReasoning || '' };
  }

  // 快速检测：是否含内部术语 / 元解释 / 前缀解释
  const hasInternal   = INTERNAL_TERMS.some(t => rawContent.includes(t));
  const hasMeta       = META_EXPLAIN_RE.test(rawContent);
  const hasPrefix     = PREFIX_EXPLAIN_RE.test(rawContent.trim());

  if (!hasInternal && !hasMeta && !hasPrefix) {
    return { content: rawContent, reasoning: originalReasoning || '' };
  }

  console.log(`[chat] Output refactoring: i=${hasInternal} m=${hasMeta} p=${hasPrefix} (${rawContent.length}c)`);

  try {
    const response = await fetch(`${deepseekBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: REFINER_PROMPT },
          { role: 'user', content: rawContent },
        ],
        stream: false,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      console.error(`[chat] Refiner API error: ${response.status}`);
      return { content: rawContent, reasoning: originalReasoning || '' };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const refined = data.choices[0]?.message?.content || rawContent;

    console.log(`[chat] Refactored: ${rawContent.length}c → ${refined.length}c`);
    return { content: refined, reasoning: rawContent };
  } catch (err) {
    console.error(`[chat] Refactor failed: ${(err as Error).message}`);
    return { content: rawContent, reasoning: originalReasoning || '' };
  }
}

// ── Chat 路由器 ──

export function createChatRouter(deps: {
  systemPrompt: string;
  triState: TriStateOrchestrator;
  healthMonitor: HealthMonitor;
  apiKey: string;
  /** SICR 种子引力场：用用户消息语义匹配休眠种子，返回筛选后的上下文文本 */
  getSeedContext?: (userMessage: string) => Promise<string>;
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

      // 3. 构建 system prompt（含 SICR 种子引力场 + ESA 注意力状态）
      const esa = ESACore.getInstance();
      const esaState = esa.beforeMessage(message);
      const seedContext = getSeedContext ? await getSeedContext(message) : '';

      let fullSystemPrompt = systemPrompt;
      if (seedContext) {
        fullSystemPrompt += `\n\n${seedContext}`;
      }
      if (esaState.attentionNote) {
        fullSystemPrompt += `\n\n${esaState.attentionNote}`;
      }

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
      let reason = '';  // BUGFIX 2026-05-01: 移到 while 循环外，供响应体引用

      // 构建 tools 参数（自动注入 ESA + Self-Scan 工具定义）
      const esaTools = getEsaToolDefinitions();
      const selfScanTool = getSelfScanToolDefinition();

      // 兼容：AI 可能自然推断出 read-file / read_file 为独立工具名
      // 注册为独立工具定义，让 DeepSeek 知道可以调用它
      // 注意：绝对路径路由到 tools 路由（受安全白名单控制），相对路径路由到 self-scan
      const readFileTool = {
        type: 'function' as const,
        function: {
          name: 'read_file',
          description: '读取文件。支持两种模式：① 绝对路径（如 "C:\\path\\file.txt"）→ 通过安全白名单控制，可读取外部文件；② 相对路径（如 "esa-core.ts"）→ 读取 mainfold-agent 自身源代码。',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: '目标文件的路径。绝对路径读取外部文件（需在白名单中），相对路径读取自身源代码。',
              },
              file: {
                type: 'string',
                description: 'filePath 的别名，二选一。',
              },
            },
          },
        },
      };

      // Phase D 工具定义：使 DeepSeek 可通过 function calling 调用沙箱工具
      const execTool = {
        type: 'function' as const,
        function: {
          name: 'exec',
          description: '在沙箱工作目录中执行 shell 命令。命令本身不受沙箱限制（可在命令中 cd 到任何位置），但默认 cwd 设置在沙箱内。可通过 cd 访问 HARNESS 等外部路径。',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: '要执行的 shell 命令（如 "ls"、"dir"、"type README.md"）',
              },
              timeout: {
                type: 'number',
                description: '超时时间（毫秒），默认 30000',
              },
            },
            required: ['command'],
          },
        },
      };

      const writeFileTool = {
        type: 'function' as const,
        function: {
          name: 'write-file',
          description: '向文件写入内容。路径受安全白名单控制，超出沙箱的绝对路径需提前授权。',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: '目标文件路径（绝对路径需在白名单中）',
              },
              content: {
                type: 'string',
                description: '要写入的文件内容',
              },
            },
            required: ['filePath', 'content'],
          },
        },
      };

      const lsTool = {
        type: 'function' as const,
        function: {
          name: 'ls',
          description: '列出目录内容。路径受安全白名单控制，超出沙箱的绝对路径需提前授权。',
          parameters: {
            type: 'object',
            properties: {
              dirPath: {
                type: 'string',
                description: '要列出的目录路径。不传则列出沙箱根目录。',
              },
            },
          },
        },
      };

      const gitTool = {
        type: 'function' as const,
        function: {
          name: 'git',
          description: '执行 Git 操作。工作目录受安全白名单控制。',
          parameters: {
            type: 'object',
            properties: {
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Git 参数列表，如 ["log", "--oneline", "-5"]',
              },
              dir: {
                type: 'string',
                description: 'Git 仓库目录路径（绝对路径需在白名单中）',
              },
            },
            required: ['args'],
          },
        },
      };

      const httpTool = {
        type: 'function' as const,
        function: {
          name: 'http',
          description: '发送 HTTP 请求（只读为主：GET/HEAD/POST/PUT/DELETE）。用于调用外部 API 或获取网页内容。',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: '请求目标 URL',
              },
              method: {
                type: 'string',
                description: 'HTTP 方法：GET（默认）/POST/PUT/DELETE/HEAD',
              },
              headers: {
                type: 'object',
                description: '请求头键值对（可选）',
              },
              body: {
                type: 'string',
                description: 'POST/PUT 请求体（可选）',
              },
            },
            required: ['url'],
          },
        },
      };

      const builtInTools = [...esaTools, selfScanTool, readFileTool, execTool, writeFileTool, lsTool, gitTool, httpTool];
      let requestTools = parsed.data.tools;
      const requestToolChoice = parsed.data.tool_choice;
      if (requestTools && requestTools.length > 0) {
        // 用户带了自定义 tools → 追加内置工具
        requestTools = [...requestTools, ...builtInTools];
      } else {
        // WebUI 场景：用户未提供 tools → 默认注入内置工具
        requestTools = builtInTools;
      }

      while (toolCallDepth < MAX_TOOL_CALL_DEPTH) {
        toolCallDepth++;

        // 构建 API 请求体
        const apiRequestBody: Record<string, unknown> = {
          model: normalizedModel,
          messages: workingMessages,
          stream: false,
          max_tokens: 131072,
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
        reason = data.choices[0]?.finish_reason || '';

        totalTokens += data.usage?.total_tokens || 0;

        // 检查是否有 tool_calls
        // BUGFIX 2026-05-01: DeepSeek V4-Flash 的 finish_reason 可能不是 'tool_calls'
        // 只要 choice 携带了 tool_calls 就应该进入循环消费，不依赖 finish_reason 的字符串值
        if (choice?.tool_calls && choice.tool_calls.length > 0) {
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

        // Phase 1: 输出重构（仅对非 function-calling 的最终回复生效）
        // BUGFIX 2026-05-01: 当 toolCallDepth > 1 时跳过重构，避免重构器吞掉长回复
        if (finalContent && finalContent.length > 10 && toolCallDepth > 0 && toolCallDepth <= 1) {
          const refactored = await refactorOutput(finalContent, finalReasoning, apiKey, DEEPSEEK_BASE_URL);
          finalContent = refactored.content;
          finalReasoning = refactored.reasoning || finalReasoning;
        }

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

      // 7. ESA: 更新具身自注意力状态（对话后回调）
      esa.afterMessage(finalContent || '', finalContent !== null && finalContent.length > 0);

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
        finish_reason: reason,                     // ← BUGFIX 2026-05-01: 暴露原始 finish_reason 供诊断
        working_messages_len: workingMessages.length, // ← BUGFIX 2026-05-01: 暴露上下文长度供诊断
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
