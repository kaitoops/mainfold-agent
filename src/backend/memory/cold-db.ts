/**
 * cold-db.ts — Phase E1: 冷记忆层
 *
 * 基于 better-sqlite3 的文件级持久化数据库。
 * 用于自动记录（auto-log）所有对话和工具操作。
 *
 * 与 routes/memories.ts 的区别：
 *   memories.ts — 内存库（:memory:），WebUI MemoryPage 数据源，手动管理
 *   cold-db.ts  — 文件库（config/cold_memory.sqlite3），自动写入，永久保留
 *
 * 与 mempalace/knowledge_graph.ts 的关系：
 *   KG — 结构化三元组知识图谱（实体-关系）
 *   ColdDB — 原始操作日志（时间序列，非结构化）
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ── Types ──

export interface ConversationLog {
  id: string;
  session_id: string | null;
  user_message: string;
  assistant_message: string;
  model: string;
  token_used: number;
  tool_call_depth: number;
  reasoning_used: boolean;
  created_at: string;
}

export interface ToolOperationLog {
  id: string;
  session_id: string | null;
  tool_name: string;
  arguments_summary: string;
  result_summary: string;
  exit_code: number | null;
  duration_ms: number;
  created_at: string;
}

export interface ColdMemoryStats {
  total_conversations: number;
  total_operations: number;
  oldest_conversation: string | null;
  newest_conversation: string | null;
  tool_breakdown: Record<string, number>;
}

// ── Daily Log 类型（WorkBuddy 移植） ──

export interface DailyLog {
  id: string;
  date: string;           // YYYY-MM-DD
  session_id: string | null;
  turn_count: number;
  content: string;        // 日志内容（Markdown）
  summary: string | null; // 摘要（自动提取）
  tags: string | null;    // 标签（JSON 数组）
  created_at: string;
  updated_at: string;
}

export interface DailyLogStats {
  total_logs: number;
  date_range: { earliest: string | null; latest: string | null };
  avg_turns_per_day: number;
}

// ── ColdMemory ──

export class ColdMemory {
  private db: DatabaseType;

  /**
   * @param dbPath 数据库文件路径。默认 ':memory:'（仅测试用）。
   *               生产环境应使用文件路径，例如 'config/cold_memory.sqlite3'。
   */
  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        model TEXT DEFAULT 'deepseek-v4-flash',
        token_used INTEGER DEFAULT 0,
        tool_call_depth INTEGER DEFAULT 0,
        reasoning_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tool_operations (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        tool_name TEXT NOT NULL,
        arguments_summary TEXT,
        result_summary TEXT,
        exit_code INTEGER,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Daily Log 表（WorkBuddy 移植）
      CREATE TABLE IF NOT EXISTS daily_logs (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        session_id TEXT,
        turn_count INTEGER DEFAULT 0,
        content TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversation_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversation_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_toolops_created ON tool_operations(created_at);
      CREATE INDEX IF NOT EXISTS idx_toolops_name ON tool_operations(tool_name);
      CREATE INDEX IF NOT EXISTS idx_toolops_session ON tool_operations(session_id);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_session ON daily_logs(session_id);
    `);
  }

  // ── Write ──

  /**
   * 记录一次对话（user → assistant）。
   * @returns 记录 ID
   */
  logConversation(entry: Omit<ConversationLog, 'id' | 'created_at'>): string {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO conversation_logs (id, session_id, user_message, assistant_message, model, token_used, tool_call_depth, reasoning_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.session_id, entry.user_message, entry.assistant_message, entry.model, entry.token_used, entry.tool_call_depth, entry.reasoning_used ? 1 : 0, now);
    return id;
  }

  /**
   * 记录一次工具操作。
   * @returns 记录 ID
   */
  logToolOperation(entry: Omit<ToolOperationLog, 'id' | 'created_at'>): string {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tool_operations (id, session_id, tool_name, arguments_summary, result_summary, exit_code, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.session_id, entry.tool_name, entry.arguments_summary, entry.result_summary, entry.exit_code, entry.duration_ms, now);
    return id;
  }

  // ── Batch Write ──

  /**
   * 批量记录多次对话（事务写入，性能优化）。
   */
  logConversations(entries: Array<Omit<ConversationLog, 'id' | 'created_at'>>): number {
    const count = entries.length;
    const insert = this.db.prepare(`
      INSERT INTO conversation_logs (id, session_id, user_message, assistant_message, model, token_used, tool_call_depth, reasoning_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batchInsert = this.db.transaction((items: Array<Omit<ConversationLog, 'id' | 'created_at'>>) => {
      for (const item of items) {
        const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        insert.run(id, item.session_id, item.user_message, item.assistant_message, item.model, item.token_used, item.tool_call_depth, item.reasoning_used ? 1 : 0, now);
      }
    });
    batchInsert(entries);
    return count;
  }

  /**
   * 批量记录多次工具操作（事务写入）。
   */
  logToolOperations(entries: Array<Omit<ToolOperationLog, 'id' | 'created_at'>>): number {
    const count = entries.length;
    const insert = this.db.prepare(`
      INSERT INTO tool_operations (id, session_id, tool_name, arguments_summary, result_summary, exit_code, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batchInsert = this.db.transaction((items: Array<Omit<ToolOperationLog, 'id' | 'created_at'>>) => {
      for (const item of items) {
        const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        insert.run(id, item.session_id, item.tool_name, item.arguments_summary, item.result_summary, item.exit_code, item.duration_ms, now);
      }
    });
    batchInsert(entries);
    return count;
  }

  // ── Read ──

  /**
   * 查询最近对话记录（倒序）。
   */
  queryConversations(limit = 50, offset = 0): ConversationLog[] {
    const rows = this.db.prepare('SELECT * FROM conversation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
    return rows.map(r => ({ ...r, reasoning_used: r.reasoning_used === 1 }));
  }

  /**
   * 查询最近工具操作记录（倒序）。
   */
  queryToolOperations(limit = 50, offset = 0): ToolOperationLog[] {
    return this.db.prepare('SELECT * FROM tool_operations ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as ToolOperationLog[];
  }

  /**
   * 搜索对话记录（基于 user_message 文本匹配）。
   */
  searchConversations(query: string, limit = 20): ConversationLog[] {
    const term = `%${query}%`;
    const rows = this.db.prepare(
      'SELECT * FROM conversation_logs WHERE user_message LIKE ? OR assistant_message LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(term, term, limit) as any[];
    return rows.map(r => ({ ...r, reasoning_used: r.reasoning_used === 1 }));
  }

  /**
   * 搜索工具操作记录（基于工具名或参数）。
   */
  searchToolOperations(query: string, limit = 20): ToolOperationLog[] {
    const term = `%${query}%`;
    return this.db.prepare(
      'SELECT * FROM tool_operations WHERE tool_name LIKE ? OR arguments_summary LIKE ? OR result_summary LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(term, term, term, limit) as ToolOperationLog[];
  }

  // ── Daily Log 操作（WorkBuddy 移植） ──

  /**
   * 记录 Daily Log。
   * @returns 记录 ID
   */
  logDaily(entry: Omit<DailyLog, 'id' | 'created_at' | 'updated_at'>): string {
    const id = `daily_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO daily_logs (id, date, session_id, turn_count, content, summary, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.date, entry.session_id, entry.turn_count, entry.content, entry.summary, entry.tags, now, now);
    return id;
  }

  /**
   * 查询指定日期的 Daily Log。
   */
  queryDailyLogs(date: string, limit = 10): DailyLog[] {
    return this.db.prepare(
      'SELECT * FROM daily_logs WHERE date = ? ORDER BY created_at DESC LIMIT ?'
    ).all(date, limit) as DailyLog[];
  }

  /**
   * 查询日期范围内的 Daily Log。
   */
  queryDailyLogsByRange(startDate: string, endDate: string): DailyLog[] {
    return this.db.prepare(
      'SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date DESC, created_at DESC'
    ).all(startDate, endDate) as DailyLog[];
  }

  /**
   * 更新 Daily Log。
   */
  updateDailyLog(id: string, updates: Partial<Pick<DailyLog, 'content' | 'summary' | 'tags' | 'turn_count'>>): boolean {
    const existing = this.db.prepare('SELECT id FROM daily_logs WHERE id = ?').get(id);
    if (!existing) return false;

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(updates.tags); }
    if (updates.turn_count !== undefined) { fields.push('turn_count = ?'); values.push(updates.turn_count); }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE daily_logs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  /**
   * 获取 Daily Log 统计信息。
   */
  getDailyLogStats(): DailyLogStats {
    const totalLogs = (this.db.prepare('SELECT COUNT(*) as n FROM daily_logs').get() as any).n;
    const dateRange = this.db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM daily_logs').get() as any;
    const avgTurns = (this.db.prepare('SELECT AVG(turn_count) as avg FROM daily_logs').get() as any).avg ?? 0;

    return {
      total_logs: totalLogs,
      date_range: { earliest: dateRange?.earliest ?? null, latest: dateRange?.latest ?? null },
      avg_turns_per_day: Math.round(avgTurns * 10) / 10,
    };
  }

  // ── Stats ──

  /**
   * 获取冷记忆统计信息。
   */
  getStats(): ColdMemoryStats {
    const totalConversations = (this.db.prepare('SELECT COUNT(*) as n FROM conversation_logs').get() as any).n;
    const totalOperations = (this.db.prepare('SELECT COUNT(*) as n FROM tool_operations').get() as any).n;
    const oldest = this.db.prepare('SELECT created_at FROM conversation_logs ORDER BY created_at ASC LIMIT 1').get() as any;
    const newest = this.db.prepare('SELECT created_at FROM conversation_logs ORDER BY created_at DESC LIMIT 1').get() as any;
    const toolBreakdown = this.db.prepare('SELECT tool_name, COUNT(*) as count FROM tool_operations GROUP BY tool_name ORDER BY count DESC').all() as any[];

    return {
      total_conversations: totalConversations,
      total_operations: totalOperations,
      oldest_conversation: oldest?.created_at ?? null,
      newest_conversation: newest?.created_at ?? null,
      tool_breakdown: Object.fromEntries(toolBreakdown.map((t: any) => [t.tool_name, t.count])),
    };
  }

  // ── Pruning ──

  /**
   * 删除超过指定天数的旧记录。
   * @param days 保留天数（默认 365）
   * @returns 删除的记录数（conversations + operations）
   */
  pruneOlderThan(days = 365): { conversations_pruned: number; operations_pruned: number } {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const convResult = this.db.prepare('DELETE FROM conversation_logs WHERE created_at < ?').run(cutoff);
    const opResult = this.db.prepare('DELETE FROM tool_operations WHERE created_at < ?').run(cutoff);
    return {
      conversations_pruned: convResult.changes,
      operations_pruned: opResult.changes,
    };
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    this.db.close();
  }
}
