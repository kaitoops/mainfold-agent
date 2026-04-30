/**
 * warm-index.ts — Phase E2: 暖记忆索引
 *
 * 文件级 JSON 索引，用于快速检索最近/重要的操作记录和技术成果。
 *
 * 设计原则：
 *   - 文件存储：JSON 格式，人类可读，方便调试
 *   - 自动裁剪：超过 maxEntries 时淘汰最旧条目
 *   - 轻量级：不含外部依赖，纯文件 I/O
 *   - 标签系统：条目可挂标签，便于分类检索
 *
 * 与 cold-db.ts 的关系：
 *   cold-db 是全量持久化存储（SQLite，永不过期）
 *   warm-index 是精炼摘要索引（JSON，有限条目，快速加载）
 */

import * as fs from 'fs';

// ── 类型 ──

export interface WarmEntry {
  /** 唯一 ID */
  id: string;
  /** 条目类型 */
  type: 'conversation' | 'tool_operation' | 'technical_pattern' | 'error_lesson' | 'system_event';
  /** 简短标题（100 字以内） */
  title: string;
  /** 详细内容摘要 */
  summary: string;
  /** 标签（用于分类和搜索） */
  tags: string[];
  /** 数据来源（如工具名、对话 session 等） */
  source: string;
  /** 重要度 0-1（越高越应保留） */
  importance: number;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;
}

export interface WarmIndexData {
  version: number;
  maxEntries: number;
  entries: WarmEntry[];
  lastPruned: string | null;
}

/** 默认最大条目数 */
const DEFAULT_MAX_ENTRIES = 500;

// ── WarmIndex ──

export class WarmIndex {
  private data: WarmIndexData;
  private filePath: string;

  /**
   * @param filePath JSON 文件路径
   * @param maxEntries 最大条目数（默认 500）
   */
  constructor(filePath: string, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.filePath = filePath;
    this.data = this.loadOrCreate(maxEntries);
  }

  // ── 文件操作 ──

  private loadOrCreate(maxEntries: number): WarmIndexData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as WarmIndexData;
        // 确保版本兼容
        if (parsed.version === 1) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[warm-index] Failed to load ${this.filePath}, creating new index`);
    }

    return {
      version: 1,
      maxEntries,
      entries: [],
      lastPruned: null,
    };
  }

  private save(): void {
    try {
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf('\\'));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[warm-index] Save failed: ${(err as Error).message}`);
    }
  }

  // ── 条目操作 ──

  /**
   * 添加一条新记录。
   * 如果条目数超过 maxEntries，自动裁剪最旧 / 最低重要度的条目。
   * @returns 条目 ID
   */
  add(entry: Omit<WarmEntry, 'id' | 'created_at' | 'updated_at'>): string {
    const id = `warm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.data.entries.push({
      id,
      type: entry.type,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      source: entry.source,
      importance: entry.importance,
      created_at: now,
      updated_at: now,
    });

    this.pruneIfNeeded();
    this.save();
    return id;
  }

  /**
   * 更新已有条目的重要度或摘要。
   */
  update(id: string, updates: Partial<Pick<WarmEntry, 'title' | 'summary' | 'tags' | 'importance'>>): boolean {
    const entry = this.data.entries.find(e => e.id === id);
    if (!entry) return false;

    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.summary !== undefined) entry.summary = updates.summary;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.importance !== undefined) entry.importance = updates.importance;
    entry.updated_at = new Date().toISOString();

    this.save();
    return true;
  }

  /**
   * 删除指定条目。
   */
  remove(id: string): boolean {
    const idx = this.data.entries.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.data.entries.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 清除所有条目。
   */
  clear(): void {
    this.data.entries = [];
    this.save();
  }

  // ── 查询 ──

  /**
   * 搜索索引（基于标题、摘要、标签、来源文本匹配）。
   */
  search(query: string): WarmEntry[] {
    const lower = query.toLowerCase();
    return this.data.entries.filter(e =>
      e.title.toLowerCase().includes(lower) ||
      e.summary.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower)) ||
      e.source.toLowerCase().includes(lower)
    ).sort((a, b) => b.importance - a.importance);
  }

  /**
   * 按标签过滤。
   */
  getByTag(tag: string): WarmEntry[] {
    return this.data.entries
      .filter(e => e.tags.includes(tag))
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * 按类型过滤。
   */
  getByType(type: WarmEntry['type']): WarmEntry[] {
    return this.data.entries
      .filter(e => e.type === type)
      .sort((a, b) => b.importance - a.importance);
  }

  /**
   * 获取最近的 N 条记录。
   */
  getRecent(limit = 20): WarmEntry[] {
    return this.data.entries
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  /**
   * 获取全部条目（不带裁剪）。
   */
  getAll(): WarmEntry[] {
    return [...this.data.entries];
  }

  // ── 统计 ──

  getStats(): { total: number; byType: Record<string, number>; byTag: Record<string, number> } {
    const byType: Record<string, number> = {};
    const byTag: Record<string, number> = {};

    for (const e of this.data.entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      for (const t of e.tags) {
        byTag[t] = (byTag[t] ?? 0) + 1;
      }
    }

    return {
      total: this.data.entries.length,
      byType,
      byTag,
    };
  }

  // ── 裁剪 ──

  /**
   * 获取系统上下文摘要（限 3000 字符以内，适合注入 prompt）。
   *
   * 策略：
   *   1. 按重要度排序取 top N
   *   2. 如果超长，截断到 3000 字符
   *   3. 追加最近时间信息
   */
  getContextSummary(maxChars = 3000): string {
    const sorted = [...this.data.entries].sort((a, b) => b.importance - a.importance);
    const lines: string[] = [];

    lines.push(`[WarmIndex] ${this.data.entries.length} entries (max ${this.data.maxEntries})`);
    lines.push('');

    for (const entry of sorted) {
      const line = `[${entry.type}] ${entry.title}`;
      if (lines.join('\n').length + line.length + entry.summary.length + 5 > maxChars) {
        lines.push(`... and ${sorted.length - lines.length + 1} more`);
        break;
      }
      lines.push(line);
      if (entry.summary) {
        lines.push(`  → ${entry.summary.slice(0, 120)}`);
      }
    }

    return lines.join('\n');
  }

  private pruneIfNeeded(): void {
    if (this.data.entries.length <= this.data.maxEntries) return;

    // 按重要度升序排序，删除最不重要的超量条目
    this.data.entries.sort((a, b) => {
      // 先按重要度升序，同重要度按时间升序（更旧的优先删除）
      const impDiff = a.importance - b.importance;
      if (impDiff !== 0) return impDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const excess = this.data.entries.length - this.data.maxEntries;
    this.data.entries.splice(0, excess);
    this.data.lastPruned = new Date().toISOString();
  }

  /**
   * 强制裁剪到指定数量（用于记忆整理）。
   */
  forcePrune(targetCount: number): number {
    if (this.data.entries.length <= targetCount) return 0;

    this.data.entries.sort((a, b) => {
      const impDiff = a.importance - b.importance;
      if (impDiff !== 0) return impDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const excess = this.data.entries.length - targetCount;
    this.data.entries.splice(0, excess);
    this.data.lastPruned = new Date().toISOString();
    this.save();
    return excess;
  }

  /**
   * 合并重复条目（相同 source + 相同 tags）。
   * 保留最新的一条。
   */
  deduplicate(): number {
    const seen = new Map<string, number>(); // key → index to keep
    const dupIds: string[] = [];

    this.data.entries.forEach((entry, idx) => {
      const key = `${entry.source}|${entry.tags.sort().join(',')}`;
      if (seen.has(key)) {
        const keptIdx = seen.get(key)!;
        const kept = this.data.entries[keptIdx];
        const current = entry;
        // 保留重要度更高的那条
        if (current.importance > kept.importance) {
          dupIds.push(kept.id);
          seen.set(key, idx);
        } else {
          dupIds.push(current.id);
        }
      } else {
        seen.set(key, idx);
      }
    });

    if (dupIds.length === 0) return 0;
    this.data.entries = this.data.entries.filter(e => !dupIds.includes(e.id));
    this.save();
    return dupIds.length;
  }
}
