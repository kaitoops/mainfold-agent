/**
 * import-workbuddy-experiences.ts
 * 
 * 将 WorkBuddy experiences/ 目录的结构化经验导入到 mainfold-agent WarmIndex
 * 
 * 使用方式：
 *   npx tsx scripts/import-workbuddy-experiences.ts
 * 
 * 前提条件：
 *   - WorkBuddy experiences 目录存在
 *   - mainfold-agent WarmIndex 可用
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 配置 ──

const WORKBUDDY_EXPERIENCES_PATH = 'c:\\Users\\WIN10\\WorkBuddy\\20260502221341\\.workbuddy\\memory\\experiences';
const WARM_INDEX_PATH = 'G:\\Orikarma-mainfold-navigation-mempalace-agent\\config\\warm_memory.json';

// ── 类型定义 ──

interface WorkBuddyExperience {
  id: string;
  title: string;
  category?: string;
  severity?: string;
  sensitivity?: number;
  context?: any;
  rootCause?: string;
  solution?: string;
  prevention?: string;
  tags?: string[];
  [key: string]: any;
}

interface ExecutionObservation {
  version: string;
  created: string;
  purpose: string;
  frictionPoints?: Array<{
    id: string;
    dimension: string;
    severity: string;
    title: string;
    description: string;
    rootCause?: string;
    impact?: string;
    suggestion?: string;
    status?: string;
  }>;
  [key: string]: any;
}

interface RepairEvaluation {
  version: string;
  created: string;
  purpose: string;
  repairs?: Array<{
    repairId: string;
    target: string;
    attempt?: any;
    changes?: any;
    verification?: any;
    frictionPoints?: any[];
    lessonsLearned?: string;
  }>;
  [key: string]: any;
}

// ── 导入函数 ──

function importTechDebug(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    console.log(`[import] File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  const entries: any[] = [];

  if (data.experiences && Array.isArray(data.experiences)) {
    for (const exp of data.experiences) {
      entries.push({
        type: 'technical_pattern',
        title: exp.title || 'Unknown Tech Pattern',
        summary: JSON.stringify({
          id: exp.id,
          category: exp.category,
          severity: exp.severity,
          rootCause: exp.rootCause,
          solution: exp.solution,
          prevention: exp.prevention,
          context: exp.context,
        }),
        tags: exp.tags || ['tech_debug', exp.category || 'unknown'],
        source: `workbuddy:${path.basename(filePath)}`,
        importance: exp.sensitivity || 0.5,
      });
    }
  }

  return entries;
}

function importExecutionObservation(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    console.log(`[import] File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content) as ExecutionObservation;
  const entries: any[] = [];

  if (data.frictionPoints && Array.isArray(data.frictionPoints)) {
    for (const fp of data.frictionPoints) {
      entries.push({
        type: 'friction_point',
        title: fp.title || 'Unknown Friction Point',
        summary: JSON.stringify({
          id: fp.id,
          dimension: fp.dimension,
          severity: fp.severity,
          description: fp.description,
          rootCause: fp.rootCause,
          impact: fp.impact,
          suggestion: fp.suggestion,
          status: fp.status || 'observed',
        }),
        tags: ['friction_point', fp.dimension, fp.severity],
        source: `workbuddy:${path.basename(filePath)}`,
        importance: fp.severity === 'critical' ? 0.9 : fp.severity === 'high' ? 0.7 : fp.severity === 'medium' ? 0.5 : 0.3,
      });
    }
  }

  return entries;
}

function importRepairEvaluation(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    console.log(`[import] File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content) as RepairEvaluation;
  const entries: any[] = [];

  if (data.repairs && Array.isArray(data.repairs)) {
    for (const repair of data.repairs) {
      entries.push({
        type: 'repair_evaluation',
        title: `修复: ${repair.target || 'Unknown Repair'}`,
        summary: JSON.stringify({
          repairId: repair.repairId,
          target: repair.target,
          attempt: repair.attempt,
          changes: repair.changes,
          verification: repair.verification,
          frictionPoints: repair.frictionPoints,
          lessonsLearned: repair.lessonsLearned,
        }),
        tags: ['repair_evaluation', 'repair'],
        source: `workbuddy:${path.basename(filePath)}`,
        importance: 0.6,
      });
    }
  }

  return entries;
}

// ── 主函数 ──

async function main() {
  console.log('[import] Starting WorkBuddy experiences import...');
  console.log(`[import] Source: ${WORKBUDDY_EXPERIENCES_PATH}`);
  console.log(`[import] Target: ${WARM_INDEX_PATH}`);

  // 读取现有 WarmIndex 数据
  let warmData: any = { version: 1, maxEntries: 500, entries: [], lastPruned: null };
  if (fs.existsSync(WARM_INDEX_PATH)) {
    try {
      const raw = fs.readFileSync(WARM_INDEX_PATH, 'utf-8');
      warmData = JSON.parse(raw);
      console.log(`[import] Existing WarmIndex: ${warmData.entries.length} entries`);
    } catch (err) {
      console.warn(`[import] Failed to load existing WarmIndex, creating new`);
    }
  }

  // 导入各类经验
  const allEntries: any[] = [];

  // 1. tech-debug.json
  const techEntries = importTechDebug(path.join(WORKBUDDY_EXPERIENCES_PATH, 'tech-debug.json'));
  allEntries.push(...techEntries);
  console.log(`[import] tech-debug.json: ${techEntries.length} entries`);

  // 2. execution-observation.json
  const frictionEntries = importExecutionObservation(path.join(WORKBUDDY_EXPERIENCES_PATH, 'execution-observation.json'));
  allEntries.push(...frictionEntries);
  console.log(`[import] execution-observation.json: ${frictionEntries.length} entries`);

  // 3. repair-evaluation.json
  const repairEntries = importRepairEvaluation(path.join(WORKBUDDY_EXPERIENCES_PATH, 'repair-evaluation.json'));
  allEntries.push(...repairEntries);
  console.log(`[import] repair-evaluation.json: ${repairEntries.length} entries`);

  // 添加到 WarmIndex
  for (const entry of allEntries) {
    const id = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    warmData.entries.push({
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
  }

  // 裁剪到 maxEntries
  if (warmData.entries.length > warmData.maxEntries) {
    warmData.entries.sort((a: any, b: any) => {
      const impDiff = a.importance - b.importance;
      if (impDiff !== 0) return impDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const excess = warmData.entries.length - warmData.maxEntries;
    warmData.entries.splice(0, excess);
    console.log(`[import] Pruned ${excess} entries to fit maxEntries`);
  }

  warmData.lastPruned = new Date().toISOString();

  // 保存
  fs.writeFileSync(WARM_INDEX_PATH, JSON.stringify(warmData, null, 2), 'utf-8');
  console.log(`[import] Import complete. Total entries: ${warmData.entries.length}`);
}

// ── 执行 ──

main().catch(err => {
  console.error('[import] Fatal error:', err);
  process.exit(1);
});
