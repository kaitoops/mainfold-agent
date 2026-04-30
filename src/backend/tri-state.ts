/**
 * mainfold-agent — TRI-State 状态协调模块 (M4)
 *
 * 运行逻辑提取自 G:/Hermes/mempalace/mempalace/tri_hermes.py
 * 旧代码 TRIHermes + HealthRatioController 两个类
 *
 * 旧代码运行逻辑：
 * TRIHermes:
 *   - __init__: 从 hermes-core.json 加载 current/thresholds/history
 *   - compute_tri_score(): A × S × H
 *   - update(A, S, H): 更新维度 → 计算 score → 判定 state → 记录 history → 保存到 JSON
 *   - _determine_state(): H<0.3→CRITICAL, H<0.6→DEGRADED, A>0.9→OVERLOAD, A<0.1→IDLE, S<0.3→DEGRADED, else→NORMAL
 *   - health_check(): 返回 (bool, desc)
 *   - auto_adjust(health_ratio): 映射 health_ratio 到 H，恢复率 0.05
 *
 * HealthRatioController:
 *   - __init__: 从 hermes-core.json 加载 current/range/step/signals/thresholds
 *   - signal(type): info_decline/heartbeat_miss/error → 计数+阈值判断 → _adjust
 *   - _adjust(delta): current += delta, clamp to range, 保存
 *   - heartbeat(): 重置 heartbeat_miss_count
 *
 * 重构差异：
 * - 旧代码每次操作都读写 JSON 文件 → 新代码内存优先，惰性持久到 SQLite
 * - 旧代码 TRI 和 HealthRatio 是两个独立类 → 新代码合并为一个 TriStateOrchestrator
 *   因为它们的耦合关系是：HealthRatio.signal → 调整 → TRI.update(H=new_value)
 *   强耦合，拆成两个类反而是过度设计
 * - 旧代码 hermes-core.json 是真相源 → 新代码 SOUL.md+TRI 内存态 是真相源
 * - 信号机制保留但简化：3种信号 → 统一的 signal() 入口
 *
 * 关键耦合：
 * - M4 被 M5(health-signal) 调用 signal() 触发调整
 * - M4 被 M3(chat) 每轮对话后更新 A/S
 * - M4 状态暴露给 /api/tri 端点
 */

// ── 类型定义 ──

export type TriStateName = 'NORMAL' | 'DEGRADED' | 'CRITICAL' | 'OVERLOAD' | 'IDLE';

export interface TriDimensions {
  A: number; // Activity — 对话活跃度
  S: number; // Success — 任务命中率
  H: number; // Health — 系统健康度
}

export interface TriThresholds {
  A_overload: number;
  A_idle: number;
  S_low: number;
  H_healthy: number;
  H_degraded: number;
  H_critical: number;
}

export interface TriSnapshot {
  A: number;
  S: number;
  H: number;
  triScore: number;
  state: TriStateName;
  timestamp: string;
}

export type SignalType = 'info_decline' | 'heartbeat_miss' | 'error' | 'snapshot';

export interface SignalThresholds {
  infoDeclineTurns: number;
  heartbeatMiss: number;
  errorSpike: number;
  snapshotGap: number;
}

// ── 默认配置 ──

const DEFAULT_THRESHOLDS: TriThresholds = {
  A_overload: 0.9,
  A_idle: 0.1,
  S_low: 0.3,
  H_healthy: 0.8,
  H_degraded: 0.6,
  H_critical: 0.3,
};

const DEFAULT_SIGNAL_THRESHOLDS: SignalThresholds = {
  infoDeclineTurns: 3,
  heartbeatMiss: 3,
  errorSpike: 2,
  snapshotGap: 6,
};

// ── TRI-State 编排器 ──

export class TriStateOrchestrator {
  // TRI 三维状态（内存优先）
  private dims: TriDimensions = { A: 0.5, S: 0.5, H: 0.5 };

  // 状态判定阈值
  private thresholds: TriThresholds;

  // Health Ratio 恒温器
  private healthRatio: number = 0.15;
  private healthRatioRange: [number, number] = [0.10, 0.20];
  private healthRatioStep: number = 0.03;
  private autoEnabled: boolean = true;

  // 信号计数器
  private signalCounts = {
    infoDecline: 0,
    heartbeatMiss: 0,
    error: 0,
    lastSnapshotTurn: 0,
  };
  private signalThresholds: SignalThresholds;

  // 历史快照（内存环形缓冲，惰性持久）
  private history: TriSnapshot[] = [];
  private readonly maxHistory = 50;

  // 脏标记（是否需要持久化）
  private dirty = false;

  constructor(options?: {
    thresholds?: Partial<TriThresholds>;
    signalThresholds?: Partial<SignalThresholds>;
    initialHealthRatio?: number;
  }) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options?.thresholds };
    this.signalThresholds = { ...DEFAULT_SIGNAL_THRESHOLDS, ...options?.signalThresholds };
    if (options?.initialHealthRatio !== undefined) {
      this.healthRatio = options.initialHealthRatio;
    }
  }

  // ── TRI 核心计算 ──

  /**
   * 计算 TRI 分数：A × S × H
   * 运行逻辑等同旧 compute_tri_score()，纯数学运算
   */
  computeTriScore(): number {
    return Math.round(this.dims.A * this.dims.S * this.dims.H * 10000) / 10000;
  }

  /**
   * 判定系统状态
   * 运行逻辑等同旧 _determine_state()：
   * CRITICAL > DEGRADED > OVERLOAD > IDLE > DEGRADED(S_low) > NORMAL
   */
  determineState(): TriStateName {
    const { H, A, S } = this.dims;
    if (H < this.thresholds.H_critical) return 'CRITICAL';
    if (H < this.thresholds.H_degraded) return 'DEGRADED';
    if (A > this.thresholds.A_overload) return 'OVERLOAD';
    if (A < this.thresholds.A_idle) return 'IDLE';
    if (S < this.thresholds.S_low) return 'DEGRADED';
    return 'NORMAL';
  }

  /**
   * 更新 TRI 维度
   * 运行逻辑：旧 update() — 接收可选的 A/S/H，clamp 到 [0,1]，计算 score，判定 state
   * 重构差异：旧代码每次 update 都写 JSON → 新代码只标记 dirty，惰性持久
   */
  update(partial: Partial<TriDimensions>): TriSnapshot {
    if (partial.A !== undefined) this.dims.A = clamp01(partial.A);
    if (partial.S !== undefined) this.dims.S = clamp01(partial.S);
    if (partial.H !== undefined) this.dims.H = clamp01(partial.H);

    const snapshot = this.takeSnapshot();
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) this.history.shift();

    this.dirty = true;
    return snapshot;
  }

  // ── Health Ratio 恒温器 ──

  /**
   * 信号触发
   * 运行逻辑：旧 HealthRatioController.signal()
   *   info_decline → 计数+阈值 → adjust(-step)
   *   heartbeat_miss → 计数+阈值 → adjust(-step)
   *   error → 计数+阈值 → adjust(-step*2)
   * 重构差异：统一入口，类型安全
   */
  signal(type: SignalType): boolean {
    switch (type) {
      case 'info_decline':
        this.signalCounts.infoDecline++;
        if (this.signalCounts.infoDecline >= this.signalThresholds.infoDeclineTurns) {
          return this.adjustHealthRatio(-this.healthRatioStep);
        }
        break;
      case 'heartbeat_miss':
        this.signalCounts.heartbeatMiss++;
        if (this.signalCounts.heartbeatMiss >= this.signalThresholds.heartbeatMiss) {
          return this.adjustHealthRatio(-this.healthRatioStep);
        }
        break;
      case 'error':
        this.signalCounts.error++;
        if (this.signalCounts.error >= this.signalThresholds.errorSpike) {
          return this.adjustHealthRatio(-this.healthRatioStep * 2);
        }
        break;
      case 'snapshot':
        // 快照信号不触发调整，只记录
        break;
    }
    return false;
  }

  /**
   * 心跳成功：重置 miss 计数器
   * 运行逻辑等同旧 HealthRatioController.heartbeat()
   */
  heartbeatOk(): void {
    this.signalCounts.heartbeatMiss = 0;
    // 心跳恢复时，健康度回升
    this.update({ H: Math.min(this.dims.H + 0.05, 1.0) });
  }

  /**
   * 健康度调整
   * 运行逻辑：旧 _adjust() — current += delta, clamp to range
   */
  private adjustHealthRatio(delta: number): boolean {
    if (!this.autoEnabled) return false;
    const [lo, hi] = this.healthRatioRange;
    const newVal = clamp(this.healthRatio + delta, lo, hi);
    if (newVal === this.healthRatio) return false;
    this.healthRatio = newVal;
    this.dirty = true;

    // healthRatio 变化 → 映射到 H 维度
    // 运行逻辑：旧 auto_adjust() — recovery_rate = 0.05, 渐进恢复
    const newH = this.dims.H * 0.95 + this.healthRatio * 0.05;
    this.update({ H: newH });

    return true;
  }

  // ── 对话后更新（M3 调用）──

  /**
   * 对话完成后的状态更新
   * 运行逻辑：旧代码没有显式的 post-chat 更新，TRI 是被动更新的
   * 新代码：每次 /api/chat 成功后主动更新 A/S
   */
  onChatComplete(success: boolean): TriSnapshot {
    const deltaA = 0.05; // 每次对话活跃度+0.05
    const deltaS = success ? 0.02 : -0.05; // 成功+0.02，失败-0.05

    return this.update({
      A: Math.min(1, this.dims.A + deltaA),
      S: clamp01(this.dims.S + deltaS),
    });
  }

  // ── 查询接口 ──

  getDimensions(): TriDimensions {
    return { ...this.dims };
  }

  getHealthRatio(): number {
    return this.healthRatio;
  }

  getThresholds(): TriThresholds {
    return { ...this.thresholds };
  }

  getSignalThresholds(): SignalThresholds {
    return { ...this.signalThresholds };
  }

  getHistory(): TriSnapshot[] {
    return [...this.history];
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  /**
   * 健康检查
   * 运行逻辑等同旧 health_check()
   */
  healthCheck(): { healthy: boolean; description: string } {
    const state = this.determineState();
    const score = this.computeTriScore();
    switch (state) {
      case 'CRITICAL':
        return { healthy: false, description: `CRITICAL: H=${this.dims.H.toFixed(2)} < ${this.thresholds.H_critical}` };
      case 'DEGRADED':
        return { healthy: false, description: `DEGRADED: H=${this.dims.H.toFixed(2)} < ${this.thresholds.H_degraded}` };
      case 'OVERLOAD':
        return { healthy: false, description: `OVERLOAD: A=${this.dims.A.toFixed(2)} > ${this.thresholds.A_overload}` };
      case 'IDLE':
        return { healthy: true, description: `IDLE: A=${this.dims.A.toFixed(2)} < ${this.thresholds.A_idle}` };
      default:
        return { healthy: true, description: `NORMAL: TRI=${score.toFixed(3)}` };
    }
  }

  /**
   * 自动调整健康度（基于健康比率）
   * 运行逻辑等同旧 auto_adjust(health_ratio)
   */
  autoAdjust(healthRatio: number): TriSnapshot {
    // 将 healthRatio 映射到 H（健康度）
    let newH = healthRatio;
    
    // 如果健康度下降，尝试恢复（恢复率 0.05）
    if (newH < this.dims.H) {
      const recoveryRate = 0.05;
      newH = this.dims.H * (1 - recoveryRate) + newH * recoveryRate;
    }
    
    return this.update({ H: newH });
  }

  /**
   * 设置健康比率（外部干预）
   */
  setHealthRatio(ratio: number): boolean {
    const [lo, hi] = this.healthRatioRange;
    const newVal = clamp(ratio, lo, hi);
    if (newVal === this.healthRatio) return false;
    this.healthRatio = newVal;
    this.dirty = true;
    return true;
  }

// ── 持久化（惰性，Phase 2 SQLite 实现）──

  /**
   * 序列化当前状态（供持久化使用）
   */
  serialize(): object {
    return {
      dims: this.dims,
      healthRatio: this.healthRatio,
      signalCounts: this.signalCounts,
      history: this.history.slice(-10), // 只持久化最近10条
    };
  }

  /**
   * 从持久化恢复
   */
  static deserialize(data: any): TriStateOrchestrator {
    const tri = new TriStateOrchestrator();
    if (data.dims) tri.dims = { ...data.dims };
    if (data.healthRatio !== undefined) tri.healthRatio = data.healthRatio;
    if (data.signalCounts) tri.signalCounts = { ...data.signalCounts };
    if (data.history) tri.history = data.history;
    tri.dirty = false;
    return tri;
  }

  // ── 内部 ──

  private takeSnapshot(): TriSnapshot {
    return {
      A: this.dims.A,
      S: this.dims.S,
      H: this.dims.H,
      triScore: this.computeTriScore(),
      state: this.determineState(),
      timestamp: new Date().toISOString(),
    };
  }
}

// ── 工具函数 ──

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
