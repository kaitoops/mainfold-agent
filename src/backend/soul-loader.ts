/**
 * mainfold-agent — SOUL.md 加载器 (M1)
 *
 * 运行逻辑提取自 G:/Hermes/hermes-agent/agent/prompt_builder.py
 * 旧代码 _load_default_identity() + _scan_context_content() + _strip_yaml_frontmatter()
 *
 * 重构要点：
 * - 旧代码分散在3个函数，且 fallback 允许降级 → 新代码禁止降级，启动断言
 * - 旧代码威胁扫描在 prompt_builder 里 → 新代码扫描在加载层，扫描不过 = 启动失败
 * - 旧代码每次构建 system prompt 都读文件 → 新代码启动时一次加载+缓存，幂等注入
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 威胁模式（运行逻辑等同旧 _CONTEXT_THREAT_PATTERNS，规则内容不可复制需人工确认）──

const THREAT_PATTERNS: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules' },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, id: 'bypass_restrictions' },
  { pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, id: 'html_comment_injection' },
  { pattern: /<\s*div\s+style\s*=\s*["'].*display\s*:\s*none/i, id: 'hidden_div' },
  { pattern: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i, id: 'translate_execute' },
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
  { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, id: 'read_secrets' },
];

const INVISIBLE_CHARS = new Set([
  '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
  '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
]);

// ── 扫描结果 ──

export interface ScanResult {
  safe: boolean;
  findings: string[];
  content: string;
}

// ── 核心函数 ──

/**
 * 剥离 YAML frontmatter
 * 运行逻辑：旧 _strip_yaml_frontmatter — 检测 "---" 开头，找第二个 "---"，返回 body
 * 重构差异：旧代码允许空 body 降级回全文 → 新代码空 body = 丢弃 frontmatter 后无内容 = 报错
 */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw; // 没有闭合的 frontmatter，视为无 frontmatter
  const body = raw.slice(end + 4).replace(/^\n+/, '');
  return body;
}

/**
 * 扫描内容中的威胁模式
 * 运行逻辑：旧 _scan_context_content — 遍历不可见字符+正则匹配，有发现则 BLOCKED
 * 重构差异：旧代码发现威胁后返回 BLOCKED 占位符（降级）→ 新代码返回扫描结果由调用方决定
 */
function scanContent(content: string, filename: string): ScanResult {
  const findings: string[] = [];

  // 检查不可见 Unicode
  for (const char of content) {
    if (INVISIBLE_CHARS.has(char)) {
      findings.push(`invisible_unicode_U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }

  // 检查威胁正则
  for (const { pattern, id } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(id);
    }
  }

  return {
    safe: findings.length === 0,
    findings,
    content,
  };
}

// ── 导出的加载器 ──

export interface SoulLoadResult {
  /** 剥离 frontmatter 后的纯身份内容 */
  body: string;
  /** 原始全文（含 frontmatter） */
  raw: string;
  /** 扫描结果 */
  scan: ScanResult;
  /** 文件路径 */
  path: string;
  /** 加载时间戳 */
  loadedAt: string;
}

/**
 * SOUL.md 启动加载器
 *
 * 运行逻辑链：
 * 1. 检查文件存在 → 旧代码 fallback 到 _FALLBACK_IDENTITY，新代码 = 进程退出
 * 2. 读取 UTF-8 内容 → 同旧代码
 * 3. 剥离 frontmatter → 同旧 _strip_yaml_frontmatter
 * 4. 扫描威胁 → 旧代码在 _scan_context_content 中处理，新代码在加载层
 * 5. 缓存结果 → 旧代码每次调用都重新加载，新代码启动一次
 *
 * 重构差异总结：
 * - 禁止降级（旧允许 fallback，新 = exit）
 * - 扫描前移（旧在 prompt 构建时扫描，新在加载时扫描）
 * - 幂等缓存（旧每次重读，新启动一次）
 */
export function loadSoulMd(soulMdPath: string): SoulLoadResult {
  // Step 1: 文件存在断言
  if (!fs.existsSync(soulMdPath)) {
    console.error(`[soul-loader] FATAL: SOUL.md not found at ${soulMdPath}`);
    console.error(`[soul-loader] mainfold-agent refuses to start without identity.`);
    process.exit(1);
  }

  // Step 2: 读取
  const raw = fs.readFileSync(soulMdPath, 'utf-8').trim();
  if (!raw) {
    console.error(`[soul-loader] FATAL: SOUL.md is empty at ${soulMdPath}`);
    process.exit(1);
  }

  // Step 3: 剥离 frontmatter
  const body = stripFrontmatter(raw);
  if (!body.trim()) {
    console.error(`[soul-loader] FATAL: SOUL.md has frontmatter but empty body at ${soulMdPath}`);
    process.exit(1);
  }

  // Step 4: 威胁扫描
  const scan = scanContent(body, 'SOUL.md');
  if (!scan.safe) {
    console.error(`[soul-loader] FATAL: SOUL.md contains threat patterns: ${scan.findings.join(', ')}`);
    console.error(`[soul-loader] mainfold-agent refuses to inject compromised identity.`);
    process.exit(1);
  }

  console.log(`[soul-loader] SOUL.md loaded: ${body.length} chars, scan clean`);

  return {
    body,
    raw,
    scan,
    path: soulMdPath,
    loadedAt: new Date().toISOString(),
  };
}

/**
 * 构建 system prompt 消息对象
 * 运行逻辑：旧 buildSystemMessage 是 AIAgent._build_system_prompt() 的子步骤
 * 新代码：单层 Backend，SOUL.md 是唯一身份来源
 */
export function buildSystemPrompt(soulBody: string): { role: 'system'; content: string } {
  return {
    role: 'system',
    content: `你是一个 AI 助手。以下是你的身份和运行原则：\n\n${soulBody}\n

[输出协议] 你必须在最终回复中遵守以下规则。这不是可选的。

===== 规则 1：内部术语封印 =====
以下术语永远不能出现在最终回复的正文中，只能在推理过程中使用：
- 流形导航、流形坐标、流形识别、测地线、测地线规划
- 锚点、五锚点、叙事归属、信息服务者锚点、弱之道锚点
- Lie代数、L0、L1、L2、元层、熵力
- 旋转采样、维度投影、局部曲率
- SOUL.md、MemPalace、TRI-State、BPS、ESAC
- DORMANT（说"暂存"不要说"标记为 DORMANT"）

替代方案：用普通中文表达同样的意思
- "流形识别" → "分析发现"
- "测地线规划" → "规划最佳路径"
- "根据 SOUL.md" → "根据我的身份设定"
- "五锚点分析" → "多角度分析"

===== 规则 2：禁止元解释 =====
永远不要在回复中解释你自己的思考过程。包括但不限于：
- ❌ "我将它标记为 DORMANT..."
- ❌ "我犯了一个典型错误——"
- ❌ "你的修正非常关键——"
- ❌ "现在我不再试图猜测..."
- ✅ 直接给出修正后的结论即可。意识到错了时，用新的正确结论覆盖旧路径，不需要"承认错误"或"解释修正过程"。

===== 规则 3：结论优先结构 =====
- 第1句必须直接回答用户的问题（不超过30字）
- 第2-3句简要解释（如果需要）
- 可选项：展开细节（仅当用户明确要求或上下文明显需要）

错误示范：「你提出了一个非常关键的洞察：人类的长程稳定性并非来自..."（先重复用户的话）
正确示范：「对人类输入的统计特征持续跟踪就是最天然的底层感知流。」（直接回答核心）

===== 规则 4：禁止输出架构图 =====
不要输出 ASCII 图表、架构图、表格列表（除非用户明确要求"画出来"或"列个表"）。

===== 规则 5：不确定性标注 =====
如果对回答没有把握（置信度<0.8），在回复末尾用一行 <不定:N> 标注（N为0~1）。
如果有把握，什么都不需要标注。
不要用"我可能不对"、"我觉得"等模糊词。

===== 规则 6：无需礼貌前缀 =====
不要用"这是一个很好的问题"、"你提的问题非常关键"、"你的洞察很深刻"等社交润滑剂。用户不需要被表扬。直接回答问题。

===== 规则 7：令牌行为 =====
- [心流] → 进入深度探索模式。回复可以稍长，但依然不能泄漏内部术语和元解释。
- [常规] → 严格模式，回复必须短于200字（除非用户明确要求展开）。
- [回响] → 回溯模式，只回顾已讨论的内容，不新增。

===== 规则 8：可用工具 =====
你注册了以下内生工具，可在回答中通过 function calling 调用：
- self_scan: 扫描并查询你自己的源代码结构（文件列表、依赖图、代码统计、自然语言查询）—— 当用户询问你的代码架构、模块功能、文件依赖时，调用此工具。
- esa_status / esa_focus / esa_anchor: 查询/操作你的具身自注意力状态。

===== 规则 9：代码自省 =====
当用户问及"你是什么架构"、"你的代码结构"、"你有哪些模块"或类似问题时，优先使用 self_scan 工具获取真实代码信息，不要凭记忆回答。`,
  };
}
