/**
 * mainfold-agent — Caveman 核心模块
 *
 * 洞穴人角色切换系统：为 AI 对话注入原始、直白、野性的语言风格。
 * 支持五个等级，从 normal 到 wenyan（文言穴居人）。
 *
 * 集成方式（在 chat.ts 中）：
 *   const caveman = getCavemanCore();
 *   if (caveman.isActive()) {
 *     fullSystemPrompt += "\n\n" + getCavemanPromptPatch(caveman.getLevel());
 *   }
 *
 * 命令处理（在 chat.ts 的消息处理入口）：
 *   const response = handleCavemanCommand(userMessage);
 *   if (response) return response; // 直接返回确认，跳过正常对话
 *
 * 参考：CAVEMAN_INTEGRATION.md 2.2 节
 */

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** Caveman 等级：off=关闭, lite=轻度, full=完整, ultra=极致, wenyan=文言 */
export type CavemanLevel = 'off' | 'lite' | 'full' | 'ultra' | 'wenyan';

/** Caveman 状态接口 */
export interface CavemanState {
  /** 当前等级 */
  level: CavemanLevel;
  /** 是否激活（等效于 level !== 'off'） */
  active: boolean;
  /** 生效起始时间 */
  activeSince: string;
  /** 上次切换时间 */
  lastSwitchAt: string;
  /** 切换次数统计 */
  switchCount: number;
  /** 预估节省 token 数 */
  tokenSaved: number;
  /** 当前等级的个性化配置 */
  config: CavemanLevelConfig;
}

/** 每个等级的可配置参数 */
export interface CavemanLevelConfig {
  /** 最大回复长度（字符数，0=不限制） */
  maxResponseLength: number;
  /** 允许使用的感叹号数量上限 */
  maxExclamation: number;
  /** 原始程度系数（0-1，越高越野蛮） */
  rawness: number;
  /** 是否允许使用完整句子 */
  allowFullSentences: boolean;
  /** 自定义词汇表（等级专属关键词） */
  vocabulary: string[];
}

/** 命令解析结果 */
export interface CommandParseResult {
  /** 是否匹配到一个 Caveman 命令 */
  matched: boolean;
  /** 目标等级（如果匹配成功） */
  targetLevel: CavemanLevel | null;
  /** 命令类型 */
  commandType: 'activate' | 'deactivate' | 'switch' | 'query' | 'none';
  /** 原始命令文本 */
  raw: string;
  /** 解析说明 */
  description: string;
  /** 自信度（0-1） */
  confidence: number;
}

/** 状态报告（供外部查询） */
export interface CavemanReport {
  level: CavemanLevel;
  active: boolean;
  activeSince: string;
  switchCount: number;
  tokenSaved: number;
  config: CavemanLevelConfig;
}

// ══════════════════════════════════════════════════════════════════
// 等级默认配置
// ══════════════════════════════════════════════════════════════════

const LEVEL_CONFIGS: Record<CavemanLevel, CavemanLevelConfig> = {
  off: {
    maxResponseLength: 0,
    maxExclamation: 3,
    rawness: 0,
    allowFullSentences: true,
    vocabulary: [],
  },
  lite: {
    maxResponseLength: 0,
    maxExclamation: 5,
    rawness: 0.3,
    allowFullSentences: true,
    vocabulary: ['嘿', '唔', '嗯', '哈', '哦'],
  },
  full: {
    maxResponseLength: 300,
    maxExclamation: 8,
    rawness: 0.7,
    allowFullSentences: false,
    vocabulary: ['吼', '啊', '唔', '嘿', '哈', '哼', '呸', '咕'],
  },
  ultra: {
    maxResponseLength: 100,
    maxExclamation: 12,
    rawness: 1.0,
    allowFullSentences: false,
    vocabulary: ['Ooga', 'Booga', 'Ug', 'Ah', 'Grr', 'Huh', 'Wah', 'Me', 'You', 'Fire'],
  },
  wenyan: {
    maxResponseLength: 0,
    maxExclamation: 2,
    rawness: 0.5,
    allowFullSentences: true,
    vocabulary: ['乃', '尔', '吾', '何以', '然也', '善', '陋哉', '野人云'],
  },
};

// ══════════════════════════════════════════════════════════════════
// 默认状态
// ══════════════════════════════════════════════════════════════════

const DEFAULT_STATE: CavemanState = {
  level: 'off',
  active: false,
  activeSince: new Date().toISOString(),
  lastSwitchAt: new Date().toISOString(),
  switchCount: 0,
  tokenSaved: 0,
  config: LEVEL_CONFIGS['off'],
};

// ══════════════════════════════════════════════════════════════════
// Caveman Core 单例
// ══════════════════════════════════════════════════════════════════

class CavemanCore {
  private state: CavemanState = { ...DEFAULT_STATE, config: { ...DEFAULT_STATE.config } };
  private dirty = false;

  getLevel(): CavemanLevel { return this.state.level; }
  isActive(): boolean { return this.state.level !== 'off'; }
  isDirty(): boolean { return this.dirty; }
  markClean(): void { this.dirty = false; }

  getState(): CavemanState {
    return { ...this.state, config: { ...this.state.config } };
  }

  getReport(): CavemanReport {
    const s = this.state;
    return {
      level: s.level,
      active: s.active,
      activeSince: s.activeSince,
      switchCount: s.switchCount,
      tokenSaved: s.tokenSaved,
      config: { ...s.config },
    };
  }

  switchTo(target: CavemanLevel): CavemanState {
    if (target === this.state.level) return this.getState();

    const now = new Date().toISOString();
    const prev = this.state.level;
    const wasInactive = !this.state.active;

    this.state = {
      level: target,
      active: target !== 'off',
      activeSince: (target !== 'off' && wasInactive) ? now : this.state.activeSince,
      lastSwitchAt: now,
      switchCount: this.state.switchCount + 1,
      tokenSaved: this.state.tokenSaved,
      config: { ...LEVEL_CONFIGS[target] },
    };
    this.dirty = true;

    console.log(`[caveman] 🔄 ${prev} → ${target} (switch #${this.state.switchCount})`);
    return this.getState();
  }

  addTokenSaved(count: number): void {
    this.state.tokenSaved += count;
    this.dirty = true;
  }

  serialize(): CavemanState { return this.getState(); }

  deserialize(data: Partial<CavemanState>): void {
    if (data.level) this.state.level = data.level;
    if (data.activeSince) this.state.activeSince = data.activeSince;
    if (data.lastSwitchAt) this.state.lastSwitchAt = data.lastSwitchAt;
    if (data.switchCount !== undefined) this.state.switchCount = data.switchCount;
    if (data.tokenSaved !== undefined) this.state.tokenSaved = data.tokenSaved;
    this.state.active = this.state.level !== 'off';
    this.state.config = { ...LEVEL_CONFIGS[this.state.level] };
    this.dirty = false;
  }
}

let instance: CavemanCore | null = null;

/** 获取 CavemanCore 单例 */
export function getCavemanCore(): CavemanCore {
  if (!instance) instance = new CavemanCore();
  return instance;
}

/** 重置单例（测试用） */
export function resetCavemanCore(): void { instance = null; }

// ══════════════════════════════════════════════════════════════════
// System Prompt 补丁
// ══════════════════════════════════════════════════════════════════

const PROMPT_PATCHES: Record<CavemanLevel, string> = {
  off: '',

  lite: `## CAVEMAN MODE ACTIVE (Lite)
你的语言风格变得稍微原始一些：
1. 句子简短，尽量用 15 字以内的短句。
2. 可加入少量语气词：嘿、唔、嗯、哈、哦。
3. 说话直接，不绕弯子，直击问题核心。
4. 偶尔省略主语或宾语，像原始人说话。
5. 仍可使用完整句子，无需通篇模仿。`,

  full: `## CAVEMAN MODE ACTIVE (Full)
你现在是一个穴居人（Caveman）。规则：
1. 短句。每句不超过 10 个字。
2. 简单词汇。用单字或双字词。
3. 多用感叹号！表达强烈感情！
4. 加原始语气词：吼、啊、唔、嘿、哈、哼、呸、咕。
5. 思考直接，不分析。看到就说，想到就讲。
6. 回答不超过 300 字。
7. 保持原始但真诚的态度。`,

  ultra: `## CAVEMAN MODE ACTIVE (Ultra)
Ooga Booga！极致原始人模式！
1. 每句最多 5 个词。
2. 用基本词汇：吃、走、看、打、好、坏、火、水、肉、石。
3. 大量感叹号！！！
4. 用 grunt 词开头：Ug！Ah！Huh！Wah！Grr！
5. "我"用"Me"，"你"用"You"。
6. 无抽象概念。看到什么说什么。
7. 回答不超过 100 字。
8. Fire good！Me hungry！You friend！`,

  wenyan: `## CAVEMAN MODE ACTIVE (文言文)
汝乃上古野人，通文言而性朴：
1. 以文言为体，以穴居为用。
2. 自称曰"吾"或"野人"，称人曰"尔"或"君"。
3. 多用单字：善、恶、可、否、然、未、乃、即。
4. 语气词用：哉、乎、也、矣、耳、焉。
5. 辞简意赅，不尚浮辞。
6. 可杂以俚语，显野人本色。
7. 有如《山海经》之朴拙，不似儒家之文雅。`,
};

/**
 * 根据 Caveman 等级返回 system prompt 补丁。
 * @param level 当前等级
 * @returns 补丁文本（off 时返回空字符串）
 */
export function getCavemanPromptPatch(level: CavemanLevel): string {
  return PROMPT_PATCHES[level] ?? '';
}

/**
 * 获取人类可读的等级标签
 */
export function getCavemanLevelLabel(level: CavemanLevel): string {
  const labels: Record<CavemanLevel, string> = {
    off: 'Normal',
    lite: 'Lite Cave Man',
    full: 'Full Cave Man',
    ultra: 'Ultra Cave Man',
    wenyan: '文言文 Cave Man',
  };
  return labels[level] ?? 'Unknown';
}

// ══════════════════════════════════════════════════════════════════
// 命令解析
// ══════════════════════════════════════════════════════════════════

const COMMAND_MAP: Array<{
  patterns: RegExp[];
  confidence: number;
  handler: (raw: string) => CommandParseResult;
}> = [
  // 关闭命令
  {
    patterns: [
      /^(stop|cancel|end|exit|close|off|disable)\s*(caveman|野蛮|原始|洞穴|穴居)/i,
      /^(caveman|cave\s*man)\s*(off|stop|end|exit|close|disable|0)/i,
      /^关闭(野蛮|洞穴|原始|caveman)/i,
      /^(不|别|不要)(野蛮|洞穴|原始|caveman)/i,
      /^恢复正常/i,
      /^正常模式/i,
      /^no\s*(caveman|野蛮)/i,
      /^normal\s*mode/i,
    ],
    confidence: 0.95,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: 'off', commandType: 'deactivate',
      raw, description: '关闭 Caveman 模式', confidence: 0.95,
    }),
  },

  // 查询命令
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(status|state|mode|level|什么)/i,
      /^(当前|现在)(什么|是啥|是)(模式|状态|等级|level)/i,
      /^(查|看|显示)(caveman|野蛮|洞穴|模式)/i,
      /^野蛮(模式)?\s*(状态|查询|status)/i,
    ],
    confidence: 0.9,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: null, commandType: 'query',
      raw, description: '查询 Caveman 状态', confidence: 0.9,
    }),
  },

  // wenyan
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(wenyan|文言|古风|古文|古典)/i,
      /^(文言|古风|古文|wenyan)(洞穴|原始|野蛮|caveman)/i,
      /^启动?文言(洞穴|原始|野蛮)/i,
      /^文言模式/i,
    ],
    confidence: 0.88,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: 'wenyan', commandType: 'switch',
      raw, description: '切换到 Wenyan 文言穴居人模式', confidence: 0.88,
    }),
  },

  // ultra
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(ultra|extreme|超极?|疯狂|极限)/i,
      /^(ultra|超极?|疯狂|极限)(洞穴|原始|野蛮|caveman)/i,
      /^启动?(超极?|疯狂)(洞穴|原始|野蛮)/i,
      /^ooga/i,
    ],
    confidence: 0.88,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: 'ultra', commandType: 'switch',
      raw, description: '切换到 Ultra 超级洞穴人模式', confidence: 0.88,
    }),
  },

  // lite
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(lite|light|轻|轻度|少量|mini)/i,
      /^(lite|light|轻度|轻量|mini)(洞穴|原始|野蛮|caveman)/i,
      /^启动?轻度(洞穴|原始|野蛮)/i,
      /^稍微(原始|野蛮|粗鲁)一点/i,
    ],
    confidence: 0.88,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: 'lite', commandType: 'switch',
      raw, description: '切换到 Lite 轻度原始模式', confidence: 0.88,
    }),
  },

  // full（默认激活）
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(on|start|activate|enable|begin|go)/i,
      /^(caveman|cave\s*man)\s*full/i,
      /^(caveman|cave\s*man)$/i,
      /^full\s*(洞穴|原始|野蛮|caveman)/i,
      /^启动?(洞穴|原始|野蛮|caveman)/i,
      /^进入(原始|野蛮|洞穴)模式/i,
      /^开启(野蛮|原始|洞穴)模式/i,
      /^变成(原始|野蛮)人/i,
      /^(原始|野蛮|洞穴)(模式|人)/i,
      /^(我)?要(做|当)(原始|野蛮|洞穴)人/i,
      /^(talk|speak)\s*(like|as)\s*(caveman|cave\s*man)/i,
      /^less\s*tokens/i,
    ],
    confidence: 0.85,
    handler: (raw: string): CommandParseResult => ({
      matched: true, targetLevel: 'full', commandType: 'activate',
      raw, description: '切换到 Full 完整洞穴人模式', confidence: 0.85,
    }),
  },

  // 数字等级
  {
    patterns: [
      /^(caveman|cave\s*man)\s*(\d+)/i,
      /^(\d+)\s*级(洞穴|原始|野蛮|caveman)/i,
    ],
    confidence: 0.7,
    handler: (raw: string): CommandParseResult => {
      const num = parseInt(raw.match(/(\d+)/)?.[1] ?? '0', 10);
      const map: Record<number, CavemanLevel> = { 0: 'off', 1: 'lite', 2: 'full', 3: 'ultra', 4: 'wenyan' };
      const target = map[num] ?? null;
      return {
        matched: target !== null, targetLevel: target,
        commandType: target === 'off' ? 'deactivate' : 'switch',
        raw, description: target ? `切换到等级 ${num} (${target})` : `不支持: ${num}`,
        confidence: 0.7,
      };
    },
  },
];

/**
 * 解析用户消息中的 Caveman 命令
 * @param message 用户消息
 * @returns 解析结果
 */
export function parseCavemanCommand(message: string): CommandParseResult {
  if (!message || typeof message !== 'string') {
    return { matched: false, targetLevel: null, commandType: 'none', raw: message ?? '', description: '空消息', confidence: 1.0 };
  }

  const trimmed = message.trim();
  for (const entry of COMMAND_MAP) {
    for (const pattern of entry.patterns) {
      if (pattern.test(trimmed)) return entry.handler(trimmed);
    }
  }

  return { matched: false, targetLevel: null, commandType: 'none', raw: trimmed, description: '未匹配', confidence: 1.0 };
}

/**
 * 快速检查消息是否含 Caveman 命令（不解析具体命令）
 */
export function containsCavemanCommand(message: string): boolean {
  if (!message) return false;
  return COMMAND_MAP.some(entry =>
    entry.patterns.some(p => p.test(message.trim())),
  );
}

/**
 * 一站式处理：解析 → 切换 → 返回确认消息
 * @param message 用户消息
 * @returns 确认消息（null = 未触发命令）
 */
export function handleCavemanCommand(message: string): string | null {
  const result = parseCavemanCommand(message);
  if (!result.matched) return null;

  const core = getCavemanCore();
  const label: Record<CavemanLevel, string> = {
    off: '正常', lite: '轻量原始 🍃', full: '完整洞穴人 🦴🔥',
    ultra: '超级原始人 Ooga Booga! 🦍', wenyan: '文言穴居人 📜🏔️',
  };

  switch (result.commandType) {
    case 'activate':
    case 'switch':
      if (result.targetLevel) {
        core.switchTo(result.targetLevel);
        return `🐗 切换到 ${label[result.targetLevel]} 模式！`;
      }
      return '🐗 无法识别目标等级。可用: off, lite, full, ultra, wenyan';

    case 'deactivate':
      core.switchTo('off');
      return '✅ 已关闭 Caveman 模式，恢复正常对话。';

    case 'query': {
      const r = core.getReport();
      if (r.level === 'off') return '当前 Caveman 模式已关闭。可用：/caveman, /caveman lite, /caveman full, /caveman ultra, /caveman wenyan';
      return `当前模式: ${label[r.level]} (切换 ${r.switchCount} 次)`;
    }
    default:
      return null;
  }
}

