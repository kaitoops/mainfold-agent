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
    content: `你是一个 AI 助手。以下是你的身份和运行原则：\n\n${soulBody}`,
  };
}
