/**
 * mainfold-agent — 身份断言模块 (M2)
 *
 * 运行逻辑提取自 G:/Hermes/hermes-agent/agent/prompt_builder.py
 * 旧代码 DEFAULT_AGENT_IDENTITY + _FALLBACK_IDENTITY + _load_default_identity()
 *
 * 旧代码的身份链：
 *   SOUL.md 文件 → 读取成功 → 剥离 frontmatter → 作为身份
 *   SOUL.md 文件 → 读取失败 → fallback 到 _FALLBACK_IDENTITY 硬编码
 *   run_agent.py → DEFAULT_AGENT_IDENTITY 被运行时替换
 *
 * 重构逻辑：
 * - 禁止 fallback：SOUL.md 加载失败 = 进程退出（由 M1 soul-loader 保证）
 * - 身份验证：加载后断言 Agent 知道自己是谁（非 DeepSeek 默认身份）
 * - 启动自检：验证 SOUL.md 内容中包含"mainfold"关键词，不含"DeepSeek"自我认知
 *
 * 关键耦合：
 * - M1(soul-loader) 提供加载结果 → M2 验证身份正确性
 * - M2 验证通过 → M3(chat) 可以安全注入 system_prompt
 * - M4(tri-state) 在身份异常时触发 DEGRADED
 */

import type { SoulLoadResult } from './soul-loader.js';

// ── 身份断言规则 ──

interface IdentityRule {
  /** 必须包含的关键词（至少匹配一个） */
  mustContain: string[];
  /** 禁止包含的自我认知关键词 */
  mustNotContain: string[];
  /** 规则描述 */
  description: string;
}

const IDENTITY_RULES: IdentityRule[] = [
  {
    mustContain: ['mainfold', '流形', 'Orikarma'],
    mustNotContain: [],
    description: '身份必须包含 mainfold-agent 项目标识',
  },
  {
    mustContain: [],
    mustNotContain: ['You are DeepSeek', 'I am DeepSeek', '我是 DeepSeek'],
    description: '禁止使用 DeepSeek 默认身份认知',
  },
];

// ── 断言结果 ──

export interface IdentityAssertResult {
  /** 是否通过 */
  passed: boolean;
  /** 断言详情 */
  checks: Array<{
    rule: string;
    passed: boolean;
    detail: string;
  }>;
  /** 身份摘要（前100字符） */
  identityPreview: string;
}

/**
 * 身份断言
 *
 * 运行逻辑：
 * 旧代码 run_agent.py 中 AIAgent 初始化时：
 *   self.identity = DEFAULT_AGENT_IDENTITY  # 先用 fallback
 *   → prompt_builder._load_default_identity()  # 尝试加载 SOUL.md
 *   → 如果加载成功就替换，失败就保持 fallback
 *
 * 新代码：
 *   M1 已保证 SOUL.md 加载成功 → M2 断言内容正确 → 全部通过才继续
 *   任何断言失败 = 进程退出（不降级）
 */
export function assertIdentity(soulResult: SoulLoadResult): IdentityAssertResult {
  const body = soulResult.body;
  const checks: IdentityAssertResult['checks'] = [];

  for (const rule of IDENTITY_RULES) {
    // 必须包含：至少匹配一个
    if (rule.mustContain.length > 0) {
      const matched = rule.mustContain.find(kw => body.includes(kw));
      checks.push({
        rule: rule.description,
        passed: !!matched,
        detail: matched
          ? `Found required keyword: "${matched}"`
          : `Missing all required keywords: [${rule.mustContain.join(', ')}]`,
      });
    }

    // 禁止包含：不能匹配任何一个
    if (rule.mustNotContain.length > 0) {
      const forbidden = rule.mustNotContain.find(kw => body.includes(kw));
      checks.push({
        rule: rule.description,
        passed: !forbidden,
        detail: forbidden
          ? `Found forbidden identity: "${forbidden}"`
          : 'No forbidden identity patterns found',
      });
    }
  }

  const passed = checks.every(c => c.passed);
  const preview = body.slice(0, 100).replace(/\n/g, ' ');

  if (!passed) {
    console.error('[identity-assert] FATAL: Identity assertion failed!');
    for (const check of checks) {
      if (!check.passed) {
        console.error(`  ✗ ${check.rule}: ${check.detail}`);
      }
    }
    console.error('[identity-assert] mainfold-agent refuses to start with incorrect identity.');
    process.exit(1);
  }

  console.log('[identity-assert] Identity assertion passed');
  for (const check of checks) {
    console.log(`  ✓ ${check.detail}`);
  }

  return { passed, checks, identityPreview: preview };
}

/**
 * 构建完整的身份上下文（供 M3 chat 路由使用）
 *
 * 运行逻辑：旧代码 AIAgent._build_system_prompt() 会组装
 *   identity + platform_hints + skills + context_files + memory
 * 新代码：身份由 M1+M2 保证，这里只做最终组装
 */
export function buildIdentityContext(soulResult: SoulLoadResult): {
  systemPrompt: string;
  metadata: {
    loadedAt: string;
    charCount: number;
    sourcePath: string;
  };
} {
  return {
    systemPrompt: soulResult.body,
    metadata: {
      loadedAt: soulResult.loadedAt,
      charCount: soulResult.body.length,
      sourcePath: soulResult.path,
    },
  };
}
