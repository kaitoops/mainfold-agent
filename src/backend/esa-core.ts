/**
 * mainfold-agent — 具身自注意力认知架构（ESA Core）
 *
 * 基于 ESA v1 设计理念（五轮流形导航综合报告）的具体代码实现。
 *
 * 核心架构：
 * ┌─────────────────────────────────────────────────┐
 * │  ESA Core                                       │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
 * │  │  FOCUS   │  │  WANDER  │  │  REWIND  │      │
 * │  │ (聚焦态) │  │ (漫游态) │  │ (回溯态) │      │
 * │  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
 * │       │              │              │            │
 * │       └──────────────┴──────────────┘            │
 * │                      │                          │
 * │              ┌───────▼────────┐                  │
 * │              │  BPS 感知流     │                  │
 * │              │ (低带宽持续追踪) │                  │
 * │              └────────────────┘                  │
 * │                                                   │
 * │  置信度估算器 ← 注意力衰减 ← 安全锚点回溯         │
 * └─────────────────────────────────────────────────┘
 *
 * 三层注意力状态：
 *   FOCUS  — 任务执行态，注意力高度集中，置信度≥0.6
 *   WANDER — 探索/放松态，置信度中等，允许发散联想
 *   REWIND — 回退防御态，置信度<0.3，回到最后安全锚点
 *
 * BPS（底层感知流）统计追踪：
 *   低带宽持续监测用户交互模式：轮次计数、消息长度、沉默时间、情绪信号
 *
 * 关键机制：
 *   - 动态注意力衰减：长时间相同模式 → 注意力权值递减
 *   - 置信度估算：基于上下文充分性、任务复杂度、最近纠正频率
 *   - 安全锚点回溯：当置信度低于阈值时，自动回到已知安全状态
 */

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 三层注意力状态 */
export type ESAState = 'FOCUS' | 'WANDER' | 'REWIND';

/** BPS 单次交互记录 */
export interface BpsRecord {
  /** 时间戳 */
  timestamp: string;
  /** 当前注意力状态 */
  state: ESAState;
  /** 用户消息长度 */
  userMessageLength: number;
  /** 是否是纠正信号（消息含"不对"、"错"、"修复"等词） */
  isCorrection: boolean;
  /** 是否含有高不确定性词（"也许"、"可能"、"不确定"等） */
  hasUncertainty: boolean;
  /** 置信度分（0-1） */
  confidence: number;
  /** 注意力衰减值（0-1，越大表示衰减越严重） */
  attentionDecay: number;
  /** 沉默时间（自上次消息以来的秒数） */
  silenceSeconds: number;
}

/** 安全锚点 */
export interface SafetyAnchor {
  /** 锚点描述 */
  description: string;
  /** 创建时间 */
  createdAt: string;
  /** 触发此锚点的上下文摘要 */
  contextSummary: string;
  /** 此锚点被回退的次数 */
  fallbackCount: number;
}

/** ESA 状态报告 */
export interface EsaStatusReport {
  /** 当前注意力状态 */
  state: ESAState;
  /** 当前置信度 */
  confidence: number;
  /** 当前注意力衰减 */
  attentionDecay: number;
  /** BPS 历史记录数 */
  bpsHistorySize: number;
  /** 最近交互时间 */
  lastInteractionAt: string | null;
  /** 当前沉默时间（秒） */
  silenceSeconds: number;
  /** 最近纠正次数（近 10 轮内） */
  recentCorrections: number;
  /** 安全锚点数量 */
  anchorCount: number;
  /** 状态持续时间（秒） */
  stateDuration: number;
}

/** ESA 配置参数 */
export interface EsaConfig {
  /** 状态切换冷却时间（毫秒），防止频繁切换 */
  stateCooldownMs: number;
  /** 高置信度阈值 */
  highConfidenceThreshold: number;
  /** 低置信度阈值（低于此值触发 REWIND） */
  lowConfidenceThreshold: number;
  /** 注意力衰减速率（每轮衰减量） */
  attentionDecayRate: number;
  /** 注意力恢复速率（每轮恢复量，新交互时触发） */
  attentionRecoveryRate: number;
  /** BPS 历史最大记录数 */
  maxBpsHistory: number;
  /** 状态持续时间触发降级（毫秒）：同一状态持续过久 → 衰减 */
  stateStagnationThresholdMs: number;
  /** 纠正信号窗口大小（轮次） */
  correctionWindowSize: number;
  /** 纠正信号窗口内允许的最大纠正次数 */
  maxCorrectionsInWindow: number;
}

// ══════════════════════════════════════════════════════════════════
// 默认配置
// ══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: EsaConfig = {
  stateCooldownMs: 10_000,
  highConfidenceThreshold: 0.6,
  lowConfidenceThreshold: 0.3,
  attentionDecayRate: 0.05,
  attentionRecoveryRate: 0.15,
  maxBpsHistory: 100,
  stateStagnationThresholdMs: 300_000, // 5 分钟
  correctionWindowSize: 10,
  maxCorrectionsInWindow: 3,
};

// ══════════════════════════════════════════════════════════════════
// ESA Core 单例类
// ══════════════════════════════════════════════════════════════════

export class ESACore {
  private static instance: ESACore | null = null;

  private _state: ESAState = 'FOCUS';
  private _confidence: number = 0.5;
  private _attentionDecay: number = 0;
  private _bpsHistory: BpsRecord[] = [];
  private _safetyAnchors: SafetyAnchor[] = [];
  private _config: EsaConfig;
  private _stateChangedAt: number = Date.now();
  private _lastInteractionAt: number | null = null;
  private _lastCorrectionWindowStart: number = 0;

  private constructor(config?: Partial<EsaConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取单例实例 */
  static getInstance(config?: Partial<EsaConfig>): ESACore {
    if (!ESACore.instance) {
      ESACore.instance = new ESACore(config);
    }
    return ESACore.instance;
  }

  /** 重置单例（主要用于测试） */
  static resetInstance(): void {
    ESACore.instance = null;
  }

  // ══════════════════════════════════════════════════════════════
  // 公共属性访问
  // ══════════════════════════════════════════════════════════════

  get state(): ESAState { return this._state; }
  get confidence(): number { return this._confidence; }
  get attentionDecay(): number { return this._attentionDecay; }
  get bpsHistory(): ReadonlyArray<BpsRecord> { return this._bpsHistory; }
  get safetyAnchors(): ReadonlyArray<SafetyAnchor> { return this._safetyAnchors; }

  // ══════════════════════════════════════════════════════════════
  // 核心 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 对话前调用：在 chat.ts 处理用户消息之前执行。
   * 根据当前 BPS 状态调整注意力模式，返回建议的系统 prompt 注入文本。
   */
  beforeMessage(userMessage: string): {
    state: ESAState;
    attentionNote: string;
    confidence: number;
  } {
    const now = Date.now();
    const silenceSeconds = this._lastInteractionAt
      ? Math.floor((now - this._lastInteractionAt) / 1000)
      : 0;

    // 更新 BPS 记录
    const record: BpsRecord = {
      timestamp: new Date().toISOString(),
      state: this._state,
      userMessageLength: userMessage.length,
      isCorrection: this._detectCorrection(userMessage),
      hasUncertainty: this._detectUserUncertainty(userMessage),
      confidence: this._confidence,
      attentionDecay: this._attentionDecay,
      silenceSeconds,
    };
    this._bpsHistory.push(record);

    // 限制 BPS 历史大小
    if (this._bpsHistory.length > this._config.maxBpsHistory) {
      this._bpsHistory = this._bpsHistory.slice(-this._config.maxBpsHistory);
    }

    // 更新交互时间
    this._lastInteractionAt = now;

    // 确认新交互 → 注意力恢复
    this._attentionDecay = Math.max(0, this._attentionDecay - this._config.attentionRecoveryRate);

    // 更新置信度
    this._updateConfidence(record);

    // 检查是否需要状态切换
    this._checkStateTransition(record);

    // 生成注意力提示文本（注入到 system prompt）
    const attentionNote = this._generateAttentionNote(record);

    return {
      state: this._state,
      attentionNote,
      confidence: this._confidence,
    };
  }

  /**
   * 对话后调用：在 chat.ts 完成响应后执行。
   * 更新 BPS 性能指标，可能触发状态切换。
   */
  afterMessage(responseContent: string, success: boolean): void {
    // 评估响应质量
    const responseLength = responseContent.length;

    // 如果响应成功，增加置信度
    if (success) {
      this._confidence = Math.min(1, this._confidence + 0.03);

      // 高置信度响应 → 添加安全锚点
      if (this._confidence >= this._config.highConfidenceThreshold) {
        this._addSafetyAnchor(
          `成功响应: ${responseContent.slice(0, 80)}...`,
          responseContent.slice(0, 200),
        );
      }
    } else {
      // 响应失败 → 降低置信度
      this._confidence = Math.max(0, this._confidence - 0.1);

      // 置信度过低 → 自动切换到 REWIND
      if (this._confidence < this._config.lowConfidenceThreshold) {
        this._switchState('REWIND', 'response_failure');
      }
    }

    // 注意力衰减（长时间同一模式）
    if (this._state === 'FOCUS') {
      // 持续聚焦超过阈值 → 轻微衰减（防过热）
      const stateDuration = Date.now() - this._stateChangedAt;
      if (stateDuration > this._config.stateStagnationThresholdMs) {
        this._attentionDecay = Math.min(1, this._attentionDecay + this._config.attentionDecayRate);
      }
    }
  }

  /**
   * 手动切换到指定状态。
   */
  switchState(target: ESAState, reason: string): void {
    this._switchState(target, reason);
  }

  /**
   * 添加安全锚点。
   */
  addSafetyAnchor(description: string, contextSummary: string): void {
    this._addSafetyAnchor(description, contextSummary);
  }

  /**
   * 获取完整状态报告。
   */
  getStatusReport(): EsaStatusReport {
    const now = Date.now();
    const recentBps = this._bpsHistory.slice(-this._config.correctionWindowSize);
    const recentCorrections = recentBps.filter(r => r.isCorrection).length;

    return {
      state: this._state,
      confidence: this._confidence,
      attentionDecay: this._attentionDecay,
      bpsHistorySize: this._bpsHistory.length,
      lastInteractionAt: this._lastInteractionAt
        ? new Date(this._lastInteractionAt).toISOString()
        : null,
      silenceSeconds: this._lastInteractionAt
        ? Math.floor((now - this._lastInteractionAt) / 1000)
        : 0,
      recentCorrections,
      anchorCount: this._safetyAnchors.length,
      stateDuration: Math.floor((now - this._stateChangedAt) / 1000),
    };
  }

  /**
   * 直接设置配置（运行时调整）。
   */
  updateConfig(partial: Partial<EsaConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  // ══════════════════════════════════════════════════════════════
  // 内部方法
  // ══════════════════════════════════════════════════════════════

  /**
   * 检测用户消息是否为纠正信号。
   */
  private _detectCorrection(message: string): boolean {
    const correctionPatterns = [
      '不对', '错', '修复', '纠正', '不是', '错了',
      'no', 'wrong', 'incorrect', 'mistake', 'fix',
      '不是这个', '你理解错了', '你搞错了', '不',
      '实际上', '其实', '并没有', '你忽略了',
      'NOT', 'ERROR', '但是', '然而',
    ];
    const lower = message.toLowerCase();
    return correctionPatterns.some(p => lower.includes(p));
  }

  /**
   * 检测用户消息中的不确定性。
   */
  private _detectUserUncertainty(message: string): boolean {
    const uncertaintyPatterns = [
      '也许', '可能', '不确定', '不太清楚', '大概',
      'maybe', 'perhaps', 'uncertain', 'not sure',
      '我想', '我觉得', '大致', '差不多',
    ];
    const lower = message.toLowerCase();
    return uncertaintyPatterns.some(p => lower.includes(p));
  }

  /**
   * 更新置信度估算。
   */
  private _updateConfidence(record: BpsRecord): void {
    let confidenceDelta = 0;

    // 1. 消息长度信号：有内容的消息提升置信度
    if (record.userMessageLength > 50) {
      confidenceDelta += 0.02;
    } else if (record.userMessageLength < 5) {
      // 非常短的消息 → 不确定性
      confidenceDelta -= 0.02;
    }

    // 2. 纠正信号：用户纠正 → 降低置信度（知道可能出错）
    if (record.isCorrection) {
      confidenceDelta -= 0.08;
    }

    // 3. 用户不确定性：用户自己不确定 → 降低置信度
    if (record.hasUncertainty) {
      confidenceDelta -= 0.05;
    }

    // 4. 长时间沉默 → 适度降低（上下文可能漂移）
    if (record.silenceSeconds > 120) { // 2 分钟
      confidenceDelta -= 0.03;
    }

    // 5. 注意力衰减 → 降低置信度
    if (this._attentionDecay > 0.3) {
      confidenceDelta -= 0.02;
    }

    // 6. 检查纠正信号窗口（近 N 轮内纠正过多 → 置信度低）
    const windowRecords = this._bpsHistory.slice(-this._config.correctionWindowSize);
    const recentCorrections = windowRecords.filter(r => r.isCorrection).length;
    if (recentCorrections >= this._config.maxCorrectionsInWindow) {
      confidenceDelta -= 0.1;
    }

    // 应用变化
    this._confidence = Math.max(0, Math.min(1, this._confidence + confidenceDelta));
  }

  /**
   * 检查是否需要注意力状态切换。
   */
  private _checkStateTransition(record: BpsRecord): void {
    const now = Date.now();
    const timeSinceLastSwitch = now - this._stateChangedAt;

    // 状态切换冷却检查
    if (timeSinceLastSwitch < this._config.stateCooldownMs) {
      return;
    }

    // 切换逻辑
    const { highConfidenceThreshold, lowConfidenceThreshold } = this._config;

    switch (this._state) {
      case 'FOCUS':
        // 聚焦态 → 可能在以下情况切到 WANDER：
        //   长时间无交互、纠正过多、置信度降至中等
        if (record.silenceSeconds > 120) {
          this._switchState('WANDER', 'prolonged_silence');
        } else if (this._confidence < lowConfidenceThreshold) {
          this._switchState('REWIND', 'confidence_drop');
        } else if (this._attentionDecay > 0.4) {
          this._switchState('WANDER', 'high_attention_decay');
        } else if (record.isCorrection && recentCorrectionsExceeded(this._bpsHistory, this._config.correctionWindowSize, this._config.maxCorrectionsInWindow)) {
          this._switchState('WANDER', 'excessive_corrections');
        }
        break;

      case 'WANDER':
        // 漫游态 → 可能在以下情况切回 FOCUS：
        //   收到有内容的完整消息、置信度恢复
        if (!record.isCorrection && record.userMessageLength > 20 && this._confidence >= highConfidenceThreshold) {
          this._switchState('FOCUS', 'clear_signal_restored');
        } else if (this._confidence < lowConfidenceThreshold) {
          this._switchState('REWIND', 'confidence_drop_from_wander');
        }
        break;

      case 'REWIND':
        // 回溯态 → 安全锚点恢复后切回 FOCUS
        if (this._safetyAnchors.length > 0 && this._confidence >= highConfidenceThreshold) {
          this._switchState('FOCUS', 'anchored_and_recovered');
        } else if (!record.isCorrection && record.userMessageLength > 30) {
          // 有新输入且不是纠正 → 尝试回到 WANDER（至少可以对话）
          this._switchState('WANDER', 'new_input_while_rewinding');
        }
        break;
    }

    // 辅助函数：检查纠正是否超过阈值
    function recentCorrectionsExceeded(history: BpsRecord[], windowSize: number, maxCorrections: number): boolean {
      const recent = history.slice(-windowSize);
      const corrections = recent.filter(r => r.isCorrection).length;
      return corrections >= maxCorrections;
    }
  }

  /**
   * 执行状态切换（带日志）。
   */
  private _switchState(target: ESAState, reason: string): void {
    if (this._state === target) return;

    const previous = this._state;
    this._state = target;
    this._stateChangedAt = Date.now();

    // REWIND 触发时，如果有安全锚点，记录回退
    if (target === 'REWIND' && this._safetyAnchors.length > 0) {
      const lastAnchor = this._safetyAnchors[this._safetyAnchors.length - 1];
      lastAnchor.fallbackCount++;
      console.log(`[esa] ⏪ REWIND → anchor "${lastAnchor.description.slice(0, 40)}" (fallback #${lastAnchor.fallbackCount})`);
    }

    // 进入 FOCUS 时重置注意力衰减
    if (target === 'FOCUS') {
      this._attentionDecay = 0;
    }

    console.log(`[esa] State: ${previous} → ${target} (reason: ${reason})`);
  }

  /**
   * 添加安全锚点。
   */
  private _addSafetyAnchor(description: string, contextSummary: string): void {
    // 避免重复添加相似的锚点
    const exists = this._safetyAnchors.some(a => a.description === description);
    if (exists) return;

    this._safetyAnchors.push({
      description,
      createdAt: new Date().toISOString(),
      contextSummary,
      fallbackCount: 0,
    });

    // 最多保留 20 个锚点
    if (this._safetyAnchors.length > 20) {
      this._safetyAnchors = this._safetyAnchors.slice(-20);
    }
  }

  /**
   * 生成注意力提示文本（注入到 system prompt）。
   */
  private _generateAttentionNote(record: BpsRecord): string {
    const parts: string[] = [];

    if (this._state === 'FOCUS') {
      if (this._confidence >= 0.8) {
        parts.push(`[ESA] 聚焦态·高置信度(${this._confidence.toFixed(2)})`);
      } else {
        parts.push(`[ESA] 聚焦态·置信度(${this._confidence.toFixed(2)})`);
      }
    } else if (this._state === 'WANDER') {
      parts.push(`[ESA] 漫游态·探索模式(${this._confidence.toFixed(2)})`);
    } else if (this._state === 'REWIND') {
      const anchorCount = this._safetyAnchors.length;
      const lastAnchor = anchorCount > 0
        ? this._safetyAnchors[anchorCount - 1].description.slice(0, 60)
        : '无之前锚点';
      parts.push(`[ESA] 回溯态·置信度低(${this._confidence.toFixed(2)})·最后锚点: ${lastAnchor}`);
    }

    if (this._attentionDecay > 0.3) {
      parts.push(`注意力衰减: ${this._attentionDecay.toFixed(2)}`);
    }

    if (record.isCorrection) {
      parts.push('用户纠正信号');
    }

    return parts.join(' · ');
  }
}

// ══════════════════════════════════════════════════════════════════
// 三角（TRI）集成辅助
// ══════════════════════════════════════════════════════════════════

/**
 * TRI-State 与 ESA 的集成函数。
 * 当 TRI 检测到卡死时通知 ESA 切换到 WANDER 状态。
 */
export function integrateTRIWithESA(
  esa: ESACore,
  triDimensions: { A: number; S: number; H: number },
): void {
  const { A, S, H } = triDimensions;

  // TRI 卡死检测：A（自主性）过低 + H（健康度）过低 → Agent 卡死
  if (A < 0.2 && H < 0.3) {
    if (esa.state !== 'REWIND') {
      esa.switchState('REWIND', 'tri_stuck_detected');
    }
  }
  // 高 S（沉默度）→ 切换到 WANDER
  else if (S > 0.7) {
    if (esa.state !== 'WANDER') {
      esa.switchState('WANDER', 'high_silence');
    }
  }
  // 高 A + 高 H → 正常 FOCUS
  else if (A > 0.6 && H > 0.6 && esa.state === 'WANDER') {
    esa.switchState('FOCUS', 'tri_recovered');
  }
}

// ══════════════════════════════════════════════════════════════════
// 工具定义（供 Function Calling 注册）
// ══════════════════════════════════════════════════════════════════

/**
 * 返回 ESA 工具定义，供 chat.ts 注册到 DeepSeek Function Calling。
 */
export function getEsaToolDefinitions() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'esa_status',
        description: '查看当前具身自注意力（ESA）状态：注意力状态（FOCUS/WANDER/REWIND）、置信度、注意力衰减、安全锚点数量。在长时间工作后调用此工具可自我评估状态。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'esa_focus',
        description: '手动将具身自注意力（ESA）切换到聚焦态。当你需要集中精力处理复杂任务时调用此工具。',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: '切换原因',
            },
          },
          required: ['reason'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'esa_anchor',
        description: '记录当前状态为安全锚点。当你在一个复杂的任务中取得进展时调用此工具，以便将来可以回溯到此状态。',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: '锚点描述',
            },
          },
          required: ['description'],
        },
      },
    },
  ];
}

/**
 * 执行 ESA 相关的 Function Calling 工具调用。
 */
export async function executeEsaTool(args: {
  name: string;
  arguments: Record<string, unknown>;
}): Promise<string> {
  const esa = ESACore.getInstance();

  switch (args.name) {
    case 'esa_status': {
      const report = esa.getStatusReport();
      return JSON.stringify(report, null, 2);
    }

    case 'esa_focus': {
      const reason = (args.arguments?.reason as string) || '手动切换';
      esa.switchState('FOCUS', reason);
      const report = esa.getStatusReport();
      return JSON.stringify({
        message: `已切换到聚焦态 (${reason})`,
        ...report,
      }, null, 2);
    }

    case 'esa_anchor': {
      const description = (args.arguments?.description as string) || '手动锚点';
      esa.addSafetyAnchor(description, 'Function Calling 手动锚定');
      const report = esa.getStatusReport();
      return JSON.stringify({
        message: `安全锚点已记录: ${description}`,
        anchorCount: report.anchorCount,
      }, null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown ESA tool: ${args.name}` });
  }
}
