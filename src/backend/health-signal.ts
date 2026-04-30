/**
 * mainfold-agent — 健康度信号模块 (M5)
 *
 * 运行逻辑提取自 G:/Hermes/hermes-agent/heartbeat_monitor.py
 * 旧代码 AgentHeartbeatMonitor + HeartbeatManager 两个类
 *
 * 旧代码运行逻辑：
 * AgentHeartbeatMonitor:
 *   - __init__: interval_ms/timeout_ms/miss_threshold, status=unknown, callbacks
 *   - heartbeat(): 收到心跳 → last_heartbeat=now, consecutive_misses=0, status=alive
 *                  → 如果之前不是 alive → 通知回调 → tri_update_callback(H=0.8)
 *   - miss(): 记录丢失 → miss_count++, consecutive_misses++
 *             → consecutive >= threshold*2 → dead, >= threshold → degraded
 *             → health_ratio_callback("heartbeat_miss") → tri_update_callback(H=max(0.3, 0.8 - misses*0.15))
 *   - _monitor_loop(): 线程循环，sleep interval → 检查 elapsed > timeout → miss()
 *   - ping(): 更新 _last_ping_time
 *
 * HeartbeatManager:
 *   - register_agent(id): 创建 monitor 并 start
 *   - unregister_agent(id): 停止并删除
 *   - get_all_status(): 返回所有 agent 状态
 *
 * 重构差异：
 * - 旧代码用 threading.Thread 做心跳监控 → 新代码用 Node.js setInterval
 * - 旧代码 monitor 和 manager 分开 → 新代码合并：单 agent 场景不需要 manager
 *   （mainfold-agent 设计为单实例，不需要多 agent 管理）
 * - 旧代码回调函数模式 → 新代码事件发射器模式（EventEmitter）
 * - 旧代码心跳超时后触发 miss → 新代码改为：心跳间隔内无人调用 ping() → 触发 miss
 * - 旧代码每次操作读写 JSON → 新代码内存优先
 *
 * 关键耦合：
 * - M5 通过事件通知 M4(tri-state) 进行状态更新
 * - M5 被 M3(chat) 每轮对话后 ping()
 * - M5 状态暴露给 /api/health 端点
 */

import { EventEmitter } from 'events';
import type { TriStateOrchestrator } from './tri-state.js';

// ── 类型 ──

export type HeartbeatStatusName = 'unknown' | 'alive' | 'degraded' | 'dead';

export interface HeartbeatStatus {
  status: HeartbeatStatusName;
  lastHeartbeat: string | null;
  missCount: number;
  consecutiveMisses: number;
}

export interface HealthMonitorOptions {
  /** 心跳检查间隔（毫秒），默认 5000 */
  intervalMs?: number;
  /** 心跳超时阈值（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 连续丢失次数阈值，默认 3 */
  missThreshold?: number;
}

// ── 事件 ──

export interface HealthMonitorEvents {
  /** 状态变化：from → to */
  statusChange: (from: HeartbeatStatusName, to: HeartbeatStatusName) => void;
  /** 心跳丢失 */
  miss: (consecutiveMisses: number) => void;
  /** 心跳恢复 */
  recover: () => void;
}

// ── 健康监控器 ──

export class HealthMonitor extends EventEmitter {
  private status: HeartbeatStatusName = 'unknown';
  private lastHeartbeatTime: string | null = null;
  private missCount = 0;
  private consecutiveMisses = 0;

  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly missThreshold: number;

  private lastPingTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  // M4(tri-state) 引用
  private triState: TriStateOrchestrator | null = null;

  constructor(options: HealthMonitorOptions = {}) {
    super();
    this.intervalMs = options.intervalMs ?? 5000;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.missThreshold = options.missThreshold ?? 3;
  }

  /**
   * 绑定 TRI-State 编排器
   * 运行逻辑：旧代码 set_health_ratio_callback + set_tri_update_callback
   * 新代码：直接引用，避免回调地狱
   */
  bindTriState(tri: TriStateOrchestrator): void {
    this.triState = tri;
  }

  /**
   * 启动监控
   * 运行逻辑：旧 start() → threading.Thread(daemon=True).start()
   * 新代码：Node.js setInterval
   */
  start(): void {
    if (this.timer) return;
    this.lastPingTime = Date.now();
    this.timer = setInterval(() => this.checkPulse(), this.intervalMs);
    console.log(`[health-monitor] Started: interval=${this.intervalMs}ms, timeout=${this.timeoutMs}ms, threshold=${this.missThreshold}`);
  }

  /**
   * 停止监控
   * 运行逻辑：旧 stop() → running=False + thread.join
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[health-monitor] Stopped');
  }

  /**
   * 心跳确认
   * 运行逻辑：旧 heartbeat()
   *   → last_heartbeat=now, consecutive_misses=0, status=alive
   *   → 如果之前不是 alive → 通知状态变化
   *   → tri_update_callback(H=0.8)
   *   → 保存到 core JSON
   *
   * 新代码：
   *   → 更新状态 + 重置计数器
   *   → 如果从 degraded/dead 恢复 → emit recover
   *   → 通知 TRI: 心跳正常
   */
  heartbeat(): void {
    const oldStatus = this.status;
    this.lastHeartbeatTime = new Date().toISOString();
    this.consecutiveMisses = 0;
    this.status = 'alive';
    this.lastPingTime = Date.now();

    if (oldStatus !== 'alive' && oldStatus !== 'unknown') {
      this.emit('statusChange', oldStatus, 'alive');
      this.emit('recover');
      console.log(`[health-monitor] Recovered: ${oldStatus} → alive`);
    }

    // 通知 TRI: 心跳正常
    if (this.triState) {
      this.triState.heartbeatOk();
    }
  }

  /**
   * Ping（轻量级心跳触发）
   * 运行逻辑：旧 ping() → _last_ping_time = time.time()
   * M3(chat) 每轮对话后调用
   */
  ping(): void {
    this.lastPingTime = Date.now();
  }

  /**
   * 获取当前状态
   */
  getStatus(): HeartbeatStatus {
    return {
      status: this.status,
      lastHeartbeat: this.lastHeartbeatTime,
      missCount: this.missCount,
      consecutiveMisses: this.consecutiveMisses,
    };
  }

  // ── 内部 ──

  /**
   * 检查心跳脉搏
   * 运行逻辑：旧 _monitor_loop()
   *   → sleep interval → 检查 elapsed > timeout → miss()
   * 新代码：setInterval 回调
   */
  private checkPulse(): void {
    const elapsed = Date.now() - this.lastPingTime;
    if (this.lastPingTime > 0 && elapsed > this.timeoutMs) {
      this.recordMiss();
    }
  }

  /**
   * 记录心跳丢失
   * 运行逻辑：旧 miss()
   *   → miss_count++, consecutive_misses++
   *   → consecutive >= threshold*2 → dead, >= threshold → degraded
   *   → health_ratio_callback("heartbeat_miss")
   *   → tri_update_callback(H=max(0.3, 0.8 - misses*0.15))
   *
   * 新代码：
   *   → 同样的状态判定逻辑
   *   → 通知 TRI: signal("heartbeat_miss") + update(H)
   */
  private recordMiss(): void {
    this.missCount++;
    this.consecutiveMisses++;

    const oldStatus = this.status;

    // 判定状态（运行逻辑等同旧代码）
    if (this.consecutiveMisses >= this.missThreshold * 2) {
      this.status = 'dead';
    } else if (this.consecutiveMisses >= this.missThreshold) {
      this.status = 'degraded';
    }

    if (oldStatus !== this.status) {
      this.emit('statusChange', oldStatus, this.status);
      console.warn(`[health-monitor] Status: ${oldStatus} → ${this.status} (misses: ${this.consecutiveMisses})`);
    }

    this.emit('miss', this.consecutiveMisses);

    // 通知 TRI: 心跳丢失信号
    if (this.triState) {
      this.triState.signal('heartbeat_miss');
      // 运行逻辑：旧 H = max(0.3, 0.8 - misses * 0.15)
      const newH = Math.max(0.3, 0.8 - this.consecutiveMisses * 0.15);
      this.triState.update({ H: newH });
    }
  }
}
