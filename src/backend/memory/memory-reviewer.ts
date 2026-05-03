/**
 * memory-reviewer.ts — Phase E3: 记忆整理后台进程
 *
 * 职责：
 *   1. 定期扫描冷记忆（ColdDB）提取有价值的知识
 *   2. 生成/更新暖记忆索引（WarmIndex）中的技术要点
 *   3. 检测使用模式（频繁工具、常见错误、技术发现）
 *   4. 裁剪去重：保持暖记忆索引精简
 *
 * 设计原则（参考 Hermes Agent 的异步精灵进程模式）：
 *   - 后台运行，不阻塞主进程
 *   - 静默工作，不在 Agent prompt 中"自言自语"
 *   - 每轮整理输出少量统计日志，不产生噪音
 *
 * 触发：
 *   - 自动：新工具操作或对话每积累到 threshold 条触发
 *   - 手动：通过 /api/memory/review 端点
 */

import { ColdMemory, ConversationLog, ToolOperationLog } from './cold-db.js';
import { WarmIndex, WarmEntry } from './warm-index.js';

// ── 配置 ──

export interface MemoryReviewerConfig {
  /** 自动整理间隔（毫秒）。默认 300000（5分钟） */
  intervalMs: number;
  /** 每积累到多少条新操作触发整理。默认 20 */
  operationThreshold: number;
  /** 暖记忆最大条目数 */
  warmMaxEntries: number;
  /** 冷记忆保留天数。默认 365 */
  coldRetentionDays: number;
  /** 是否启用自动整理 */
  enabled: boolean;
}

const DEFAULT_CONFIG: MemoryReviewerConfig = {
  intervalMs: 5 * 60 * 1000, // 5 分钟
  operationThreshold: 20,
  warmMaxEntries: 500,
  coldRetentionDays: 365,
  enabled: true,
};

// ── MemoryReviewer ──

export class MemoryReviewer {
  private config: MemoryReviewerConfig;
  private cold: ColdMemory;
  private warm: WarmIndex;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastOperationCount: number = 0;
  private isRunning: boolean = false;

  constructor(cold: ColdMemory, warm: WarmIndex, config?: Partial<MemoryReviewerConfig>) {
    this.cold = cold;
    this.warm = warm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 启动 / 停止 ──

  start(): void {
    if (!this.config.enabled) {
      console.log('[memory-reviewer] Disabled by config');
      return;
    }

    if (this.interval) {
      clearInterval(this.interval);
    }

    this.interval = setInterval(() => this.runReview(), this.config.intervalMs);
    console.log(`[memory-reviewer] Started (interval=${this.config.intervalMs}ms, threshold=${this.config.operationThreshold})`);

    // 首次立即执行（延迟 3 秒避免启动噪音）
    setTimeout(() => this.runReview(), 3000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[memory-reviewer] Stopped');
  }

  // ── 核心整理逻辑 ──

  /**
   * 执行一次记忆整理循环。
   * 可被手动触发。
   */
  async runReview(): Promise<ReviewResult> {
    if (this.isRunning) {
      return { skipped: true, reason: 'Already running', changes: 0 };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const stats = this.cold.getStats();
      const newOps = stats.total_operations - this.lastOperationCount;

      // 如果新操作数不足 threshold，跳过完整整理
      if (newOps < this.config.operationThreshold && this.lastOperationCount > 0) {
        return {
          skipped: true,
          reason: `Only ${newOps} new operations (threshold: ${this.config.operationThreshold})`,
          changes: 0,
          duration_ms: Date.now() - startTime,
        };
      }

      this.lastOperationCount = stats.total_operations;
      const changes = await this.performConsolidation();

      return {
        skipped: false,
        changes,
        duration_ms: Date.now() - startTime,
        ...stats,
      };
    } catch (err) {
      console.error(`[memory-reviewer] Review failed: ${(err as Error).message}`);
      return {
        skipped: true,
        reason: `Error: ${(err as Error).message}`,
        changes: 0,
        duration_ms: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
    }
  }

  // ── 内部整理 ──

  private async performConsolidation(): Promise<number> {
    let totalChanges = 0;

    // Step 1: 检测工具使用模式
    totalChanges += this.detectToolPatterns();

    // Step 2: 检测错误教训
    totalChanges += this.detectErrorLessons();

    // Step 3: 检测摩擦点模式（WorkBuddy 移植）
    totalChanges += this.detectFrictionPatterns();

    // Step 4: 检测修复评估模式（WorkBuddy 移植）
    totalChanges += this.detectRepairPatterns();

    // Step 5: 暖记忆去重
    const deduped = this.warm.deduplicate();
    if (deduped > 0) {
      console.log(`[memory-reviewer] Deduplicated ${deduped} warm entries`);
    }
    totalChanges += deduped;

    // Step 6: 暖记忆裁剪（如果超过 maxEntries 的 90%）
    const warmStats = this.warm.getStats();
    if (warmStats.total > this.config.warmMaxEntries * 0.9) {
      const target = Math.floor(this.config.warmMaxEntries * 0.7);
      const pruned = this.warm.forcePrune(target);
      if (pruned > 0) {
        console.log(`[memory-reviewer] Pruned ${pruned} warm entries (${warmStats.total} → ${target})`);
      }
      totalChanges += pruned;
    }

    // Step 7: 冷记忆裁剪（保留最近 N 天）
    const coldPruned = this.cold.pruneOlderThan(this.config.coldRetentionDays);
    if (coldPruned.conversations_pruned > 0 || coldPruned.operations_pruned > 0) {
      console.log(`[memory-reviewer] Cold prune: ${coldPruned.conversations_pruned} conversations, ${coldPruned.operations_pruned} operations`);
    }
    totalChanges += coldPruned.conversations_pruned + coldPruned.operations_pruned;

    return totalChanges;
  }

  // ── 模式检测 ──

  /**
   * 检测工具使用模式。
   * 如果某个工具在最近记录中出现频繁，在暖记忆中创建/更新技术模式条目。
   */
  private detectToolPatterns(): number {
    const stats = this.cold.getStats();
    let changes = 0;

    for (const [toolName, count] of Object.entries(stats.tool_breakdown)) {
      if (count >= 5) {
        // 检查是否已在暖索引中
        const existing = this.warm.search(toolName)
          .filter(e => e.type === 'technical_pattern' || e.type === 'tool_operation');

        if (existing.length === 0) {
          this.warm.add({
            type: 'technical_pattern',
            title: `频用工具: ${toolName}`,
            summary: `${toolName} 已被调用 ${count} 次，表明该工具在 workflow 中经常使用。`,
            tags: ['tool_pattern', toolName, 'auto_detected'],
            source: 'memory-reviewer',
            importance: Math.min(0.7, 0.3 + count * 0.02),
          });
          changes++;
        } else {
          // 更新重要度
          for (const entry of existing) {
            const newImp = Math.min(0.9, entry.importance + 0.05);
            if (newImp > entry.importance) {
              this.warm.update(entry.id, {
                importance: newImp,
                summary: `${toolName} 已被调用 ${count} 次。`,
              });
              changes++;
            }
          }
        }
      }
    }

    return changes;
  }

  /**
   * 检测错误教训。
   * 扫描最近工具操作中 exit_code != 0 的记录，汇总常见错误。
   */
  private detectErrorLessons(): number {
    const recentOps = this.cold.queryToolOperations(100, 0);
    const errors = recentOps.filter(op => op.exit_code && op.exit_code !== 0);
    let changes = 0;

    if (errors.length >= 3) {
      // 按工具名分组
      const errorByTool: Record<string, { count: number; examples: string[] }> = {};
      for (const err of errors) {
        if (!errorByTool[err.tool_name]) {
          errorByTool[err.tool_name] = { count: 0, examples: [] };
        }
        errorByTool[err.tool_name].count++;
        if (errorByTool[err.tool_name].examples.length < 3) {
          errorByTool[err.tool_name].examples.push(
            err.result_summary.slice(0, 100)
          );
        }
      }

      for (const [toolName, info] of Object.entries(errorByTool)) {
        if (info.count >= 3) {
          const existing = this.warm.getByTag('auto_detected_error')
            .filter(e => e.source === toolName);

          if (existing.length === 0) {
            this.warm.add({
              type: 'error_lesson',
              title: `【错误模式】${toolName} 失败 ${info.count} 次`,
              summary: `${toolName} 在最近操作中失败 ${info.count} 次。示例: ${info.examples[0]}`,
              tags: ['error_lesson', toolName, 'auto_detected_error'],
              source: toolName,
              importance: Math.min(0.8, 0.4 + info.count * 0.05),
            });
            changes++;
          }
        }
      }
    }

    return changes;
  }

  // ── 摩擦点检测（WorkBuddy 移植） ──

  /**
   * 检测摩擦点模式。
   * 扫描暖记忆中的摩擦点条目，统计高频维度和严重级别。
   */
  private detectFrictionPatterns(): number {
    const frictionEntries = this.warm.getByType('friction_point');
    let changes = 0;

    if (frictionEntries.length >= 3) {
      // 按维度分组
      const byDimension: Record<string, { count: number; severities: string[] }> = {};
      for (const entry of frictionEntries) {
        const dim = entry.tags.find(t => t.startsWith('DIM-') || ['memory_retrieval', 'rule_trigger', 'experience_reuse', 'daily_log_quality', 'cross_file_collab', 'code_quality', 'api_consistency', 'repair_observation'].includes(t));
        if (dim) {
          if (!byDimension[dim]) {
            byDimension[dim] = { count: 0, severities: [] };
          }
          byDimension[dim].count++;
          const sev = entry.tags.find(t => ['low', 'medium', 'high', 'critical'].includes(t));
          if (sev) byDimension[dim].severities.push(sev);
        }
      }

      // 为高频维度创建汇总条目
      for (const [dim, info] of Object.entries(byDimension)) {
        if (info.count >= 3) {
          const existing = this.warm.search(dim)
            .filter(e => e.type === 'observation_metric' && e.source === 'memory-reviewer');

          if (existing.length === 0) {
            const criticalCount = info.severities.filter(s => s === 'critical').length;
            const highCount = info.severities.filter(s => s === 'high').length;

            this.warm.add({
              type: 'observation_metric',
              title: `摩擦点汇总: ${dim}`,
              summary: `维度 ${dim} 已记录 ${info.count} 个摩擦点。其中 critical: ${criticalCount}, high: ${highCount}。`,
              tags: ['friction_summary', dim, 'auto_detected'],
              source: 'memory-reviewer',
              importance: Math.min(0.8, 0.4 + info.count * 0.05 + criticalCount * 0.1),
            });
            changes++;
          }
        }
      }
    }

    return changes;
  }

  // ── 修复评估检测（WorkBuddy 移植） ──

  /**
   * 检测修复评估模式。
   * 扫描暖记忆中的修复评估条目，统计修复成功率和常见摩擦点。
   */
  private detectRepairPatterns(): number {
    const repairEntries = this.warm.getByType('repair_evaluation');
    let changes = 0;

    if (repairEntries.length >= 3) {
      // 统计修复成功率
      let successCount = 0;
      let totalAttempts = 0;
      const frictionTypes: Record<string, number> = {};

      for (const entry of repairEntries) {
        try {
          const data = JSON.parse(entry.summary);
          if (data.verification?.fixVerified) successCount++;
          if (data.attempt?.number) totalAttempts += data.attempt.number;
          if (data.frictionPoints && Array.isArray(data.frictionPoints)) {
            for (const fp of data.frictionPoints) {
              frictionTypes[fp.type] = (frictionTypes[fp.type] || 0) + 1;
            }
          }
        } catch {
          // 解析失败，跳过
        }
      }

      // 创建修复汇总条目
      const existing = this.warm.search('修复汇总')
        .filter(e => e.type === 'observation_metric' && e.source === 'memory-reviewer');

      if (existing.length === 0) {
        const successRate = repairEntries.length > 0 ? Math.round((successCount / repairEntries.length) * 100) : 0;
        const topFriction = Object.entries(frictionTypes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${type}(${count})`)
          .join(', ');

        this.warm.add({
          type: 'observation_metric',
          title: '修复汇总',
          summary: `共 ${repairEntries.length} 次修复，成功率 ${successRate}%，平均尝试 ${totalAttempts > 0 ? Math.round(totalAttempts / repairEntries.length) : 0} 次。常见摩擦点: ${topFriction || '无'}`,
          tags: ['repair_summary', 'auto_detected'],
          source: 'memory-reviewer',
          importance: 0.7,
        });
        changes++;
      }
    }

    return changes;
  }

  // ── 状态 ──

  getStatus(): ReviewerStatus {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      intervalMs: this.config.intervalMs,
      operationThreshold: this.config.operationThreshold,
      warmEntryCount: this.warm.getStats().total,
      lastOperationCount: this.lastOperationCount,
    };
  }
}

// ── 类型 ──

export interface ReviewResult {
  skipped: boolean;
  reason?: string;
  changes: number;
  duration_ms?: number;
  total_conversations?: number;
  total_operations?: number;
  oldest_conversation?: string | null;
  newest_conversation?: string | null;
  tool_breakdown?: Record<string, number>;
}

export interface ReviewerStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  operationThreshold: number;
  warmEntryCount: number;
  lastOperationCount: number;
}
