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

// ── BROWSER: 浏览器自动化工具 ──

import { getBrowserToolDefinitions, BROWSER_TOOL_LABELS } from '../harness/browser-registry.js';

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
  // MiMo (小米) 别名
  'mimo-v2.5': 'mimo-v2.5',
  'mimo-v2.5-pro': 'mimo-v2.5-pro',
  'mimo-v2.5-flash': 'mimo-v2.5-flash',
};

/** 根据模型名选择 API Provider */
function getProviderConfig(modelName: string, depsApiKey: string, depsMimoApiKey?: string, depsMimoBaseUrl?: string): { baseUrl: string; apiKey: string } {
  if (modelName.startsWith('mimo-')) {
    // MiMo 提供商
    if (!depsMimoApiKey || !depsMimoBaseUrl) {
      console.warn(`[chat] MiMo model ${modelName} selected but MIMO_API_KEY or MIMO_BASE_URL not configured, falling back to DeepSeek`);
      return { baseUrl: DEEPSEEK_BASE_URL, apiKey: depsApiKey };
    }
    return { baseUrl: depsMimoBaseUrl!, apiKey: depsMimoApiKey! };
  }
  // 默认：DeepSeek 提供商
  return { baseUrl: DEEPSEEK_BASE_URL, apiKey: depsApiKey };
}

function normalizeModelName(modelId: string): string {
  return MODEL_ALIASES[modelId] ?? modelId;
}

// ── 多模态内容类型 ──

/** OpenAI 兼容的多模态内容片段 */
const ContentPartSchema: z.ZodType<Record<string, unknown>> = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['auto', 'low', 'high']).optional(),
    }),
  }),
]) as unknown as z.ZodType<Record<string, unknown>>;

type ContentPart = Record<string, unknown>;

// ── 请求/响应模型 ──

const ChatRequestSchema = z.object({
  message: z.union([z.string().min(1), z.array(ContentPartSchema)]),
  model: z.string().default('deepseek-v4-flash'),
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']).default('user'),
    content: z.union([z.string(), z.array(z.record(z.unknown()))]).default(''),
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
  /** 流式输出：true = SSE 逐 token 推送，false = 等待完整响应 */
  stream: z.boolean().default(false),
});

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
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
  content: string | ContentPart[] | null;
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

// ── Agent 状态追踪 ──

import {
  setAgentStatus,
  beginDialogue,
  resetAgentStatus,
  TOOL_LABELS,
} from './agent-status.js';

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

  // ── 本地工具（ESA 自注意力状态 + BROWSER 自动化 + Self-Scan 代码自省）──

  // BROWSER 自动化工具（在 ESA 之前，因为浏览器工具有异步执行路径）
  if (name.startsWith('browser_')) {
    const label = BROWSER_TOOL_LABELS[name] || name;
    setAgentStatus({ phase: 'tool', detail: `${label}...`, toolName: name });
    const { executeBrowserTool } = await import('../harness/browser-registry.js');
    const result = await executeBrowserTool({ name, arguments: parsedArgs });
    setAgentStatus({ phase: 'tool-result', detail: `${label} 完成`, toolName: name });
    return result;
  }

  if (name === 'esa_status' || name === 'esa_focus' || name === 'esa_anchor') {
    const label = TOOL_LABELS[name] || name;
    setAgentStatus({ phase: 'tool', detail: `${label}...`, toolName: name });
    const { executeEsaTool } = await import('../esa-core.js');
    const result = executeEsaTool({ name, arguments: parsedArgs });
    setAgentStatus({ phase: 'tool-result', detail: `${label} 完成`, toolName: name });
    return result;
  }

  if (name === 'self_scan') {
    setAgentStatus({ phase: 'tool', detail: '代码扫描...', toolName: 'self_scan', filePath: String(parsedArgs.filePath || '') });
    const { executeSelfScan } = await import('./self-scan.js');
    const result = executeSelfScan(parsedArgs as { action: string; filePath?: string; query?: string });
    setAgentStatus({ phase: 'tool-result', detail: '代码扫描完成', toolName: 'self_scan' });
    return result;
  }

  // 兼容：AI 可能自然推断出 read-file / read_file 作为独立工具名
  // 根据路径类型分流：
  //   绝对路径 → 路由到 tools 路由（受安全白名单控制，可读外部文件）
  //   相对路径 → 路由到 self-scan（只读 mainfold-agent 自身代码库）
  if (name === 'read-file' || name === 'read_file') {
    const filePath = (parsedArgs.filePath || parsedArgs.file || '') as string;
    const label = TOOL_LABELS[name] || name;
    const shortPath = filePath.length > 80 ? '...' + filePath.slice(-77) : filePath;
    setAgentStatus({ phase: 'tool', detail: `${label}: ${shortPath}`, toolName: name, filePath });
    if (path.isAbsolute(filePath)) {
      const endpoint = '/api/tools/read-file';
      const response = await fetch(`${TOOLS_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      const result = await response.json();
      setAgentStatus({ phase: 'tool-result', detail: `${label} 完成`, toolName: name });
      return JSON.stringify(result);
    }
    const { executeSelfScan } = await import('./self-scan.js');
    const result = executeSelfScan({
      action: 'read-file',
      filePath,
    });
    setAgentStatus({ phase: 'tool-result', detail: `${label} 完成`, toolName: name });
    return result;
  }

  // ── HTTP 代理工具（由 tools 路由处理后端逻辑）──

  const endpointMap: Record<string, string> = {
    exec: '/api/tools/exec',
    'read-file': '/api/tools/read-file',
    'write-file': '/api/tools/write-file',  // BUGFIX 2026-05-02: DeepSeek 输出 write_file（下划线）时查不到
    write_file: '/api/tools/write-file',     // BUGFIX 2026-05-02: 下划线别名，使 write_file 名称也能路由
    ls: '/api/tools/ls',
    git: '/api/tools/git',
    http: '/api/tools/http',
  };

  const endpoint = endpointMap[name];
  if (!endpoint) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  // 提取文件路径（write-file 常有 filePath 参数）
  const fileArg = String(parsedArgs.filePath || parsedArgs.file || parsedArgs.dir || '');
  const filePathStatus = fileArg.length > 80 ? '...' + fileArg.slice(-77) : fileArg;

  // 区分写文件和其他工具
  if (name === 'write-file') {
    setAgentStatus({
      phase: 'tool',
      detail: `写入文件: ${filePathStatus || '...'}`,
      toolName: name,
      filePath: fileArg || undefined,
    });
  } else if (name === 'exec') {
    const cmdPreview = String(parsedArgs.command || '').slice(0, 60);
    setAgentStatus({ phase: 'tool', detail: `执行: ${cmdPreview}`, toolName: name });
  } else {
    const label = TOOL_LABELS[name] || name;
    setAgentStatus({
      phase: 'tool',
      detail: `${label}${filePathStatus ? ': ' + filePathStatus : ''}`,
      toolName: name,
      filePath: fileArg || undefined,
    });
  }

  // normalization: 模型有时输出 file 而非 filePath / dir 而非 dirPath
  // 兼容 write-file 和 ls 工具
  if (parsedArgs.file && !parsedArgs.filePath) {
    parsedArgs.filePath = parsedArgs.file;
    delete parsedArgs.file;
  }
  if (parsedArgs.dir && !parsedArgs.dirPath) {
    parsedArgs.dirPath = parsedArgs.dir;
    delete parsedArgs.dir;
  }

  try {
    const response = await fetch(`${TOOLS_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedArgs),
    });
    const result = await response.json();
    const label = TOOL_LABELS[name] || name;
    setAgentStatus({ phase: 'tool-result', detail: `${label} 完成`, toolName: name });
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
  /** MiMo (小米) — 可选 API 提供商配置 */
  mimoApiKey?: string;
  mimoBaseUrl?: string;
  /** SICR 种子引力场：用用户消息语义匹配休眠种子，返回筛选后的上下文文本 */
  getSeedContext?: (userMessage: string) => Promise<string>;
  /** 收到 [心流] 前缀消息时调用的入库回调 */
  seedFlowCb?: (content: string) => void;
  /** Phase E: 冷记忆自动日志（可选） */
  coldMemory?: ColdMemory;
}): Router {
  const router = Router();
  const { systemPrompt, triState, healthMonitor, apiKey, mimoApiKey, mimoBaseUrl, getSeedContext } = deps;

  // ── POST /api/chat ──

  router.post('/api/chat', async (req: Request, res: Response) => {
    try {
      // 1. 验证请求（运行逻辑等同旧 ChatRequest Pydantic 验证）
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }
      const { message, model, conversation_history, session_id, stream: requestStream } = parsed.data;

      // 2. 心流种子自动入库
      // 如果消息以 [心流] 开头且为纯文本，自动入库到 KnowledgeGraph
      const flowPrefix = '[心流]';
      let cleanedMessage = message;
      // 只有纯文本消息才检查心流前缀
      if (typeof message === 'string') {
        const rawMessage = message;
        if (rawMessage.startsWith(flowPrefix) && deps.seedFlowCb) {
          const flowContent = rawMessage.slice(flowPrefix.length).trim();
          if (flowContent) {
            deps.seedFlowCb(flowContent);
            console.log(`[chat] Auto-seeded: ${flowContent.slice(0, 50)}...`);
            cleanedMessage = `[心流] ${flowContent}`;
          }
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
        content: m.content as string | ContentPart[],
      }));
      const userMsg: ChatMessage = { role: 'user', content: cleanedMessage as string | ContentPart[] };

      const allMessages: ChatMessage[] = [systemMsg, ...historyMsgs, userMsg];

      // 4. 标准化模型名
      const normalizedModel = normalizeModelName(model);

      // 5. 检查 API Key（根据模型动态选择）
      const provider = getProviderConfig(normalizedModel, apiKey, mimoApiKey, mimoBaseUrl);
      if (!provider.apiKey) {
        const providerName = normalizedModel.startsWith('mimo-') ? 'MIMO_API_KEY' : 'DEEPSEEK_API_KEY';
        res.status(500).json({ error: `${providerName} not configured` });
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
          description: '在沙箱工作目录中执行 shell 命令。仅用于 HARNESS 工具无法覆盖的特殊场景。文件搜索请用 self_scan(action="search", keyword="xxx")，查看工具列表请用 tool_health_check。不要用 exec dir/ls/find 搜索文件。',
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
          // BUGFIX 2026-05-02: 从 write-file 改为 write_file，与 read_file 命名一致
          // DeepSeek 模型在 function calling 中自然使用下划线命名（write_file）
          // 连字符 write-file 会导致 "Unknown tool" 错误
          name: 'write_file',
          description: '向文件写入内容。路径受安全白名单控制，超出沙箱的绝对路径需提前授权。',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: '目标文件路径（绝对路径需在白名单中）',
              },
              file: {
                type: 'string',
                description: 'filePath 的别名，二选一。',
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

      const browserTools = getBrowserToolDefinitions();
      const builtInTools = [...esaTools, ...browserTools, selfScanTool, readFileTool, execTool, writeFileTool, lsTool, gitTool, httpTool];
      let requestTools = parsed.data.tools;
      const requestToolChoice = parsed.data.tool_choice;
      if (requestTools && requestTools.length > 0) {
        // 用户带了自定义 tools → 追加内置工具
        requestTools = [...requestTools, ...builtInTools];
      } else {
        // WebUI 场景：用户未提供 tools → 默认注入内置工具
        requestTools = builtInTools;
      }

      // 标记对话开始（前端轮询 agent 状态的起始时间点）
      beginDialogue();

      // ── SSE 流式输出辅助 ──
      // 当 requestStream=true 时，设置 SSE 响应头，后续通过 res.write() 逐 token 推送
      const isStreaming = requestStream === true;
      let sseInitialized = false;

      function initSSE() {
        if (sseInitialized) return;
        sseInitialized = true;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }

      function sendSSE(event: string, data: Record<string, unknown>) {
        if (!isStreaming) return;
        initSSE();
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      /**
       * 解析 DeepSeek SSE 流，收集完整响应
       * 返回 { content, reasoning_content, tool_calls, finish_reason, usage }
       */
      async function consumeSSEStream(
        apiResponse: Response,
      ): Promise<{ content: string; reasoning: string; tool_calls: ToolCall[] | null; finish_reason: string; usage: { total_tokens: number } | null }> {
        const reader = apiResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let reasoning = '';
        let finish_reason = '';
        let usage: { total_tokens: number } | null = null;
        // tool_calls 需要从多个 chunk 中拼接
        const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // 按行解析 SSE
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
                try {
                  const chunk = JSON.parse(jsonStr) as DeepSeekApiResponse;
                  const delta = chunk.choices[0];
                  if (!delta) continue;

                  finish_reason = delta.finish_reason || finish_reason;

                  // usage 可能在最后一个 chunk
                  if (chunk.usage) usage = chunk.usage;

                  const deltaMsg = delta.message ?? (delta as Record<string, unknown>);
                  if (!deltaMsg) continue;

                  // 文本内容
                  const deltaContent = (deltaMsg as Record<string, unknown>).content;
                  if (typeof deltaContent === 'string' && deltaContent) {
                    content += deltaContent;
                    // 逐 token 推送给前端
                    sendSSE('token', { content: deltaContent, accumulated: content });
                  }

                  // reasoning_content（thinking mode）
                  const deltaReasoning = (deltaMsg as Record<string, unknown>).reasoning_content;
                  if (typeof deltaReasoning === 'string' && deltaReasoning) {
                    reasoning += deltaReasoning;
                    sendSSE('reasoning', { content: deltaReasoning });
                  }

                  // tool_calls（从 delta 中拼接）
                  const deltaToolCalls = (deltaMsg as Record<string, unknown>).tool_calls as Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }> | undefined;
                  if (deltaToolCalls && Array.isArray(deltaToolCalls)) {
                    for (const dtc of deltaToolCalls) {
                      const idx = dtc.index;
                      if (!toolCallsMap[idx]) {
                        toolCallsMap[idx] = { id: '', name: '', arguments: '' };
                      }
                      if (dtc.id) toolCallsMap[idx].id = dtc.id;
                      if (dtc.function?.name) toolCallsMap[idx].name += dtc.function.name;
                      if (dtc.function?.arguments) toolCallsMap[idx].arguments += dtc.function.arguments;
                    }
                  }
                } catch {
                  // 非 JSON 行，跳过
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        // 组装 tool_calls
        const toolCalls = Object.keys(toolCallsMap).length > 0
          ? Object.values(toolCallsMap).map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            }))
          : null;

        return { content, reasoning, tool_calls, finish_reason, usage };
      }

      while (toolCallDepth < MAX_TOOL_CALL_DEPTH) {
        toolCallDepth++;

        // 构建 API 请求体
        const apiRequestBody: Record<string, unknown> = {
          model: normalizedModel,
          messages: workingMessages,
          stream: isStreaming,
          max_tokens: 131072,
        };
        // 每轮都携带 tools 定义（DeepSeek V4 要求每轮都传 tools，否则模型看不到可用工具）
        // tool_choice 只在第一轮发送（强制模型调用工具）
        if (requestTools && requestTools.length > 0) {
          apiRequestBody.tools = requestTools as Record<string, unknown>[];
          if (toolCallDepth === 1 && requestToolChoice) {
            apiRequestBody.tool_choice = requestToolChoice;
          }
          // thinking mode 兼容：通过保留原始 response message 的 reasoning_content 字段
          // 在 tool_calls 循环中自动回传，无需禁用 thinking mode
        }

        setAgentStatus({
          phase: 'api',
          detail: toolCallDepth > 1
            ? `调用 AI (第 ${toolCallDepth} 轮)...`
            : '调用 AI 分析问题...',
        });

        const apiResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(apiRequestBody),
        });

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          const providerName = normalizedModel.startsWith('mimo-') ? 'MiMo' : 'DeepSeek';
          console.error(`[chat] ${providerName} API error: ${apiResponse.status} ${errorText}`);
          if (isStreaming) {
            sendSSE('error', { error: `${providerName} API error: ${errorText}` });
            res.end();
          } else {
            res.status(apiResponse.status).json({ error: `${providerName} API error: ${errorText}` });
          }
          return;
        }

        let choice: DeepSeekApiMessage | undefined;
        let data: DeepSeekApiResponse | undefined;

        if (isStreaming) {
          // 流式模式：逐 token 解析 SSE
          const sseResult = await consumeSSEStream(apiResponse);
          totalTokens += sseResult.usage?.total_tokens || 0;
          reason = sseResult.finish_reason;

          // 检查是否有 tool_calls
          if (sseResult.tool_calls && sseResult.tool_calls.length > 0) {
            sendSSE('tool_calls', {
              tool_calls: sseResult.tool_calls.map(tc => ({
                name: tc.function.name,
                arguments: tc.function.arguments,
              })),
            });

            // 构造兼容的 choice 对象
            const assistantMsg = {
              content: sseResult.content || null,
              tool_calls: sseResult.tool_calls,
              reasoning_content: sseResult.reasoning || undefined,
            };
            workingMessages.push(assistantMsg as unknown as Record<string, unknown>);

            // 执行每个 tool call
            for (const tc of sseResult.tool_calls) {
              console.log(`[chat] Tool call #${toolCallDepth}: ${tc.function.name}(${tc.function.arguments})`);
              sendSSE('tool_start', { name: tc.function.name, arguments: tc.function.arguments });

              const toolResult = await executeToolCall(tc);

              sendSSE('tool_result', { name: tc.function.name, result: toolResult.slice(0, 500) });
              workingMessages.push({
                role: 'tool',
                content: toolResult,
                tool_call_id: tc.id,
              });
            }

            setAgentStatus({ phase: 'tool-result', detail: '等待 AI 处理工具结果...' });
            continue;
          }

          // 普通内容响应（流式）
          finalContent = sseResult.content;
          finalReasoning = sseResult.reasoning || null;
        } else {
          // 非流式模式：等待完整 JSON 响应
          data = (await apiResponse.json()) as DeepSeekApiResponse;
          choice = data.choices[0]?.message;
          reason = data.choices[0]?.finish_reason || '';
          totalTokens += data.usage?.total_tokens || 0;

          // 检查是否有 tool_calls
          if (choice?.tool_calls && choice.tool_calls.length > 0) {
            const assistantRaw = choice as unknown as Record<string, unknown>;
            workingMessages.push(assistantRaw);

            for (const tc of choice.tool_calls) {
              console.log(`[chat] Tool call #${toolCallDepth}: ${tc.function.name}(${tc.function.arguments})`);
              const toolResult = await executeToolCall(tc);
              workingMessages.push({
                role: 'tool',
                content: toolResult,
                tool_call_id: tc.id,
              });
            }

            setAgentStatus({ phase: 'tool-result', detail: '等待 AI 处理工具结果...' });
            continue;
          }

          finalContent = choice?.content || '';
          finalReasoning = choice?.reasoning_content || null;
        }

        // Phase 1: 输出重构（仅对非 function-calling 的最终回复生效）
        // 流式模式下跳过重构（内容已逐 token 推送，无法回溯修改）
        if (!isStreaming && finalContent && finalContent.length > 10 && toolCallDepth > 0 && toolCallDepth <= 1) {
          setAgentStatus({ phase: 'refactor', detail: '优化回复格式...' });
          const refactored = await refactorOutput(finalContent, finalReasoning, apiKey, DEEPSEEK_BASE_URL);
          finalContent = refactored.content;
          finalReasoning = refactored.reasoning || finalReasoning;
        }

        setAgentStatus({ phase: 'finalizing', detail: '生成最终回复...' });
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
      if (isStreaming) {
        // 流式模式：发送 done 事件（包含完整元数据），然后关闭连接
        sendSSE('done', {
          content: finalContent,
          token_used: totalTokens,
          finish_reason: reason,
          working_messages_len: workingMessages.length,
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
        res.end();
      } else {
        // 非流式模式：返回完整 JSON
        res.json({
          content: finalContent,
          token_used: totalTokens,
          finish_reason: reason,
          working_messages_len: workingMessages.length,
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
      }

      // 重置 agent 状态（前端已收到响应，停止轮询）
      resetAgentStatus();

    } catch (err) {
      const error = err as Error;
      console.error(`[chat] Unhandled error: ${error.message}`);

      // 通知 TRI: 错误信号
      triState.signal('error');
      triState.onChatComplete(false);

      if (sseInitialized) {
        sendSSE('error', { error: error.message });
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
      resetAgentStatus();
    }
  });

  // ── GET /api/models ──
  // 运行逻辑等同旧 /api/models：返回可用模型列表

  router.get('/api/models', (_req: Request, res: Response) => {
    const mimoConfigured = !!deps.mimoApiKey;
    res.json({
      providers: {
        deepseek: {
          models: [
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '1M上下文 · 强大推理', context: '1M' },
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: '1M上下文 · 快速响应', context: '1M' },
            { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: '128K上下文 · 深度推理', context: '128K' },
          ],
        },
        ...(mimoConfigured
          ? {
              mimo: {
                models: [
                  { id: 'mimo-v2.5', name: 'MiMo V2.5', description: '多模态 · 文本/图像/视频/音频', context: '128K' },
                  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', description: '增强推理 · 多模态', context: '128K' },
                  { id: 'mimo-v2.5-flash', name: 'MiMo V2.5 Flash', description: '快速响应 · 多模态', context: '128K' },
                ],
              },
            }
          : {}),
      },
    });
  });

  return router;
}
