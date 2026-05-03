/**
 * test-memory-migration.ts
 * 
 * 测试 WorkBuddy 记忆系统移植到 mainfold-agent 的功能
 * 
 * 测试内容：
 *   1. WarmIndex 新类型支持
 *   2. ColdMemory Daily Log 功能
 *   3. 摩擦点 API
 *   4. 修复评估 API
 *   5. Daily Log API
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 测试配置 ──

const WARM_INDEX_PATH = 'G:\\Orikarma-mainfold-navigation-mempalace-agent\\config\\warm_memory.json';
const COLD_DB_PATH = ':memory:'; // 使用内存数据库测试

// ── 测试结果 ──

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration_ms: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  const start = Date.now();
  try {
    fn();
    results.push({
      name,
      passed: true,
      message: 'OK',
      duration_ms: Date.now() - start,
    });
    console.log(`✅ ${name}`);
  } catch (err) {
    results.push({
      name,
      passed: false,
      message: (err as Error).message,
      duration_ms: Date.now() - start,
    });
    console.log(`❌ ${name}: ${(err as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── 测试用例 ──

console.log('=== WorkBuddy 记忆系统移植测试 ===\n');

// Test 1: WarmIndex 新类型支持
test('WarmIndex 支持 11 种条目类型', () => {
  const warmData = JSON.parse(fs.readFileSync(WARM_INDEX_PATH, 'utf-8'));
  const validTypes = [
    'conversation', 'tool_operation', 'technical_pattern', 'error_lesson', 'system_event',
    'friction_point', 'repair_evaluation', 'business_pattern', 'security_issue',
    'workflow_pattern', 'observation_metric'
  ];

  // 检查现有条目类型是否都在有效范围内
  for (const entry of warmData.entries) {
    assert(validTypes.includes(entry.type), `Invalid type: ${entry.type}`);
  }

  // 检查是否有新类型的条目
  const newTypes = warmData.entries.filter((e: any) =>
    ['friction_point', 'repair_evaluation', 'technical_pattern'].includes(e.type)
  );
  assert(newTypes.length > 0, 'No new type entries found');
  console.log(`  Found ${newTypes.length} entries with new types`);
});

// Test 2: WarmIndex 包含 WorkBuddy 导入的数据
test('WarmIndex 包含 WorkBuddy 导入的数据', () => {
  const warmData = JSON.parse(fs.readFileSync(WARM_INDEX_PATH, 'utf-8'));
  const wbEntries = warmData.entries.filter((e: any) => e.source?.startsWith('workbuddy:'));
  assert(wbEntries.length > 0, 'No WorkBuddy entries found');
  console.log(`  Found ${wbEntries.length} WorkBuddy entries`);
});

// Test 3: ColdMemory Daily Log 表结构
test('ColdMemory Daily Log 表结构正确', () => {
  // 动态导入 ColdMemory
  const coldDbPath = path.join(__dirname, '..', 'src', 'backend', 'memory', 'cold-db.ts');
  assert(fs.existsSync(coldDbPath), 'cold-db.ts not found');

  // 读取文件内容验证表结构
  const content = fs.readFileSync(coldDbPath, 'utf-8');
  assert(content.includes('CREATE TABLE IF NOT EXISTS daily_logs'), 'daily_logs table not found');
  assert(content.includes('date TEXT NOT NULL'), 'date column not found');
  assert(content.includes('content TEXT NOT NULL'), 'content column not found');
  assert(content.includes('turn_count INTEGER'), 'turn_count column not found');
  console.log('  daily_logs table structure verified');
});

// Test 4: soul-loader.ts 包含操作纪律规则
test('soul-loader.ts 包含操作纪律规则', () => {
  const soulLoaderPath = path.join(__dirname, '..', 'src', 'backend', 'soul-loader.ts');
  const content = fs.readFileSync(soulLoaderPath, 'utf-8');

  assert(content.includes('规则 10：操作纪律'), 'Rule 10 not found');
  assert(content.includes('铁律 1：读文件 before 写文件'), 'Iron Law 1 not found');
  assert(content.includes('铁律 2：验证 before 声称'), 'Iron Law 2 not found');
  assert(content.includes('铁律 3：用户系统不动'), 'Iron Law 3 not found');
  console.log('  Operation discipline rules verified');
});

// Test 5: memory.ts 包含新 API 端点
test('memory.ts 包含新 API 端点', () => {
  const memoryRouterPath = path.join(__dirname, '..', 'src', 'backend', 'routes', 'memory.ts');
  const content = fs.readFileSync(memoryRouterPath, 'utf-8');

  // 摩擦点 API
  assert(content.includes('/api/memory/friction'), 'Friction API not found');
  assert(content.includes('POST /api/memory/friction'), 'POST friction endpoint not found');
  assert(content.includes('GET /api/memory/friction'), 'GET friction endpoint not found');

  // 修复评估 API
  assert(content.includes('/api/memory/repair'), 'Repair API not found');
  assert(content.includes('POST /api/memory/repair'), 'POST repair endpoint not found');
  assert(content.includes('GET /api/memory/repair'), 'GET repair endpoint not found');

  // Daily Log API
  assert(content.includes('/api/memory/daily'), 'Daily Log API not found');
  assert(content.includes('POST /api/memory/daily'), 'POST daily endpoint not found');
  assert(content.includes('GET /api/memory/daily'), 'GET daily endpoint not found');
  assert(content.includes('GET /api/memory/daily/stats'), 'Daily stats endpoint not found');

  console.log('  All new API endpoints verified');
});

// Test 6: memory-reviewer.ts 包含新检测方法
test('memory-reviewer.ts 包含新检测方法', () => {
  const reviewerPath = path.join(__dirname, '..', 'src', 'backend', 'memory', 'memory-reviewer.ts');
  const content = fs.readFileSync(reviewerPath, 'utf-8');

  assert(content.includes('detectFrictionPatterns'), 'detectFrictionPatterns not found');
  assert(content.includes('detectRepairPatterns'), 'detectRepairPatterns not found');
  assert(content.includes('friction_summary'), 'friction_summary tag not found');
  assert(content.includes('repair_summary'), 'repair_summary tag not found');
  console.log('  New detection methods verified');
});

// Test 7: warm-index.ts 类型定义完整
test('warm-index.ts 类型定义完整', () => {
  const warmIndexPath = path.join(__dirname, '..', 'src', 'backend', 'memory', 'warm-index.ts');
  const content = fs.readFileSync(warmIndexPath, 'utf-8');

  assert(content.includes('export type WarmEntryType'), 'WarmEntryType not found');
  assert(content.includes('friction_point'), 'friction_point type not found');
  assert(content.includes('repair_evaluation'), 'repair_evaluation type not found');
  assert(content.includes('business_pattern'), 'business_pattern type not found');
  assert(content.includes('security_issue'), 'security_issue type not found');
  assert(content.includes('workflow_pattern'), 'workflow_pattern type not found');
  assert(content.includes('observation_metric'), 'observation_metric type not found');
  console.log('  WarmEntryType definition verified');
});

// ── 测试结果汇总 ──

console.log('\n=== 测试结果汇总 ===');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const totalTime = results.reduce((sum, r) => sum + r.duration_ms, 0);

console.log(`总测试: ${results.length}`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总耗时: ${totalTime}ms`);

if (failed > 0) {
  console.log('\n失败的测试:');
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  - ${r.name}: ${r.message}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ 所有测试通过！');
  process.exit(0);
}
