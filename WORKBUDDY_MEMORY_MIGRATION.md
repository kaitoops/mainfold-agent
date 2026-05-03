# WorkBuddy 核心代码能力移植到 mainfold-agent 全局核心多层记忆系统

**创建时间**: 2026-05-03
**目的**: 将 WorkBuddy 沉淀的核心代码能力有机移植到 mainfold-agent 的全局核心多层记忆系统
**关键区分**: 全局核心多层记忆系统 ≠ 非必要不调用的 MEMPALACE 记忆系统

---

## 一、架构对比

### WorkBuddy 记忆系统
```
WorkBuddy 记忆系统
├── MEMORY.md (长期记忆，手动维护)
├── RULES.md (操作守卫，三铁律)
├── YYYY-MM-DD.md (Daily Log，每5轮自动触发)
├── experiences/ (经验索引库)
│   ├── execution-observation.json (摩擦点记录)
│   ├── repair-evaluation.json (修复效果评估)
│   ├── tech-debug.json (技术调试经验)
│   ├── business-patterns.json (商业模式)
│   ├── security-issues.json (安全问题)
│   ├── workflow-automation.json (工作流自动化)
│   └── search-strategies.json (搜索策略)
└── 操作纪律 (三铁律)
    ├── 读文件 before 写文件
    ├── 验证 before 声称
    └── 用户系统不动
```

### mainfold-agent 当前记忆系统
```
mainfold-agent 全局核心多层记忆系统
├── Layer 0: 身份层 (SOUL.md)
│   └── soul-loader.ts (启动断言+威胁扫描+幂等缓存)
├── Layer 1: 冷记忆层 (ColdMemory)
│   └── cold-db.ts (SQLite, 365天保留)
│       ├── conversation_logs (对话记录)
│       └── tool_operations (工具操作日志)
├── Layer 2: 暖记忆层 (WarmIndex)
│   └── warm-index.ts (JSON, max 500条)
│       ├── conversation
│       ├── tool_operation
│       ├── technical_pattern
│       ├── error_lesson
│       └── system_event
├── Layer 3: 记忆整理器 (MemoryReviewer)
│   └── memory-reviewer.ts (5分钟自动整理)
├── MemPalace (非必要不调用)
│   ├── knowledge_graph.ts (知识图谱)
│   ├── entity_registry.ts (实体注册)
│   ├── searcher.ts (搜索)
│   └── pathfinder.ts (路径导航)
└── ESA (具身自注意力认知架构)
    └── esa-core.ts (FOCUS/WANDER/REWIND)
```

---

## 二、移植方案

### 2.1 经验索引库 → 暖记忆层新类型

**目标**: 将 WorkBuddy 的 experiences/ 目录结构化经验移植到 mainfold-agent 的 WarmIndex

**WarmIndex 新增类型**:
```typescript
// warm-index.ts 新增类型
export type WarmEntryType = 
  | 'conversation'
  | 'tool_operation'
  | 'technical_pattern'
  | 'error_lesson'
  | 'system_event'
  | 'friction_point'      // 新增：摩擦点记录
  | 'repair_evaluation'   // 新增：修复效果评估
  | 'business_pattern'    // 新增：商业模式
  | 'security_issue'      // 新增：安全问题
  | 'workflow_pattern'    // 新增：工作流模式
  | 'observation_metric'; // 新增：观察指标
```

**映射关系**:
| WorkBuddy 文件 | mainfold-agent WarmEntry type | 说明 |
|----------------|------------------------------|------|
| execution-observation.json | friction_point | 摩擦点记录 |
| repair-evaluation.json | repair_evaluation | 修复效果评估 |
| tech-debug.json | technical_pattern | 技术调试经验（已有） |
| business-patterns.json | business_pattern | 商业模式 |
| security-issues.json | security_issue | 安全问题 |
| workflow-automation.json | workflow_pattern | 工作流模式 |
| search-strategies.json | observation_metric | 搜索策略 |

**实现步骤**:
1. 在 warm-index.ts 中添加新的 WarmEntryType
2. 创建经验导入脚本，将 WorkBuddy experiences/ 导入 WarmIndex
3. 更新 MemoryReviewer，支持新类型的自动检测和整理

### 2.2 操作纪律 → SOUL.md/soul-loader.ts 注入

**目标**: 将 WorkBuddy 的三铁律注入到 mainfold-agent 的身份层

**注入位置**: `src/backend/soul-loader.ts` 的 `buildSystemPrompt()` 函数

**新增规则**:
```typescript
// soul-loader.ts buildSystemPrompt() 中新增
===== 规则 10：操作纪律 =====
你必须遵守以下操作纪律，这不是可选的：

**铁律 1：读文件 before 写文件**
> 写文件之前必须读，不读不写。读到内容冲突要指出，不静默覆盖。

**铁律 2：验证 before 声称**
> 声称"X 能力存在" → 读实际文件验证。设计意图 ≠ 系统现状。不验证就声称 = 判断纪律崩溃。

**铁律 3：用户系统不动**
> 用户系统目录：默认只读。用户未明确授权时，不写入、不迁移、不"优化"。
```

**实现步骤**:
1. 在 soul-loader.ts 的 buildSystemPrompt() 中添加规则 10
2. 更新 SOUL.md，添加操作纪律章节
3. 在 chat.ts 中添加纪律检查逻辑（可选）

### 2.3 Daily Log → 冷记忆层新表

**目标**: 将 WorkBuddy 的 Daily Log 系统移植到 mainfold-agent 的 ColdMemory

**新增表结构**:
```sql
-- cold-db.ts 新增表
CREATE TABLE IF NOT EXISTS daily_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,           -- YYYY-MM-DD
  session_id TEXT,
  turn_count INTEGER DEFAULT 0,
  content TEXT NOT NULL,        -- 日志内容（Markdown）
  summary TEXT,                 -- 摘要（自动提取）
  tags TEXT,                    -- 标签（JSON 数组）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_session ON daily_logs(session_id);
```

**ColdMemory 新增方法**:
```typescript
// cold-db.ts 新增方法
class ColdMemory {
  // Daily Log 操作
  logDaily(date: string, content: string, sessionId?: string): string;
  queryDailyLogs(date: string, limit?: number): DailyLog[];
  queryDailyLogsByRange(startDate: string, endDate: string): DailyLog[];
  updateDailyLog(id: string, updates: Partial<DailyLog>): boolean;
  getDailyLogStats(): DailyLogStats;
}
```

**实现步骤**:
1. 在 cold-db.ts 中添加 daily_logs 表
2. 添加 DailyLog 类型定义
3. 添加 Daily Log 操作方法
4. 更新 MemoryReviewer，支持 Daily Log 的自动整理

### 2.4 摩擦点观察机制 → 暖记忆层新类型

**目标**: 将 WorkBuddy 的 8 个观察维度移植到 mainfold-agent

**WarmIndex 新增类型**: `friction_point`

**摩擦点结构**:
```typescript
interface FrictionPoint {
  id: string;
  dimension: string;      // DIM-001 到 DIM-008
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  rootCause: string;
  impact: string;
  suggestion: string;
  status: 'observed' | 'mitigated' | 'fixed';
  solution?: string;
  createdAt: string;
  updatedAt: string;
}
```

**观察维度映射**:
| WorkBuddy DIM | mainfold-agent 维度 | 说明 |
|---------------|---------------------|------|
| DIM-001 | memory_retrieval | 记忆检索效率 |
| DIM-002 | rule_trigger | 规则触发准确性 |
| DIM-003 | experience_reuse | 经验复用率 |
| DIM-004 | daily_log_quality | Daily Log 质量 |
| DIM-005 | cross_file_collab | 跨文件协作流畅度 |
| DIM-006 | code_quality | 代码质量 |
| DIM-007 | api_consistency | API 一致性 |
| DIM-008 | repair_observation | 修复过程观察 |

**实现步骤**:
1. 在 warm-index.ts 中添加 friction_point 类型
2. 创建摩擦点记录 API（POST /api/memory/friction）
3. 更新 MemoryReviewer，支持摩擦点的自动检测

### 2.5 修复效果评估 → 暖记忆层新类型

**目标**: 将 WorkBuddy 的 repair-evaluation.json 移植到 mainfold-agent

**WarmIndex 新增类型**: `repair_evaluation`

**修复评估结构**:
```typescript
interface RepairEvaluation {
  repairId: string;
  target: string;
  attempt: {
    number: number;
    firstTimeSuccess: boolean;
    deadCycles: number;
    invalidReads: number;
  };
  changes: {
    filesModified: string[];
    linesChanged: number;
    tokenConsumed: string;
  };
  verification: {
    problemReproduced: boolean;
    fixVerified: boolean;
    regression: boolean;
    userSatisfied: boolean;
  };
  frictionPoints: Array<{
    type: string;
    description: string;
    cause: string;
    prevention: string;
  }>;
  lessonsLearned: string;
  createdAt: string;
}
```

**实现步骤**:
1. 在 warm-index.ts 中添加 repair_evaluation 类型
2. 创建修复评估 API（POST /api/memory/repair）
3. 更新 MemoryReviewer，支持修复评估的自动整理

---

## 三、与 MEMPALACE 的区分

**关键原则**: 全局核心多层记忆系统 ≠ 非必要不调用的 MEMPALACE 记忆系统

| 维度 | 全局核心多层记忆系统 | MEMPALACE 记忆系统 |
|------|---------------------|-------------------|
| **定位** | 核心基础设施，始终运行 | 非必要不调用，按需激活 |
| **存储** | SQLite + JSON | SQLite (mempalace_kg.sqlite3) |
| **内容** | 对话、工具操作、经验、摩擦点 | 实体、关系、三元组 |
| **触发** | 自动（每次对话） | 手动（用户/Agent 显式调用） |
| **API** | /api/memory/* | /api/mempalace/* |
| **整理** | MemoryReviewer 自动整理 | 无自动整理 |

**移植边界**:
- ✅ 移植到全局核心多层记忆系统：经验索引、操作纪律、Daily Log、摩擦点、修复评估
- ❌ 不移植到 MEMPALACE：这些是全局核心能力，不是知识图谱实体

---

## 四、实施计划

### Phase 1: 基础设施（2小时）
1. 更新 warm-index.ts，添加新类型
2. 更新 cold-db.ts，添加 daily_logs 表
3. 更新 soul-loader.ts，添加操作纪律规则

### Phase 2: API 端点（2小时）
1. 添加摩擦点记录 API
2. 添加修复评估 API
3. 添加 Daily Log API

### Phase 3: 数据迁移（1小时）
1. 创建经验导入脚本
2. 导入 WorkBuddy experiences/ 数据
3. 验证数据完整性

### Phase 4: 自动整理（1小时）
1. 更新 MemoryReviewer，支持新类型
2. 添加摩擦点自动检测
3. 添加修复评估自动整理

### Phase 5: 测试验证（1小时）
1. 单元测试新功能
2. 集成测试整个记忆系统
3. 性能测试

**总计**: 7 小时

---

## 五、验收标准

1. ✅ WarmIndex 支持 11 种条目类型（原 5 种 + 新增 6 种）
2. ✅ ColdMemory 支持 Daily Log 表
3. ✅ soul-loader.ts 包含操作纪律规则
4. ✅ 摩擦点记录 API 可用
5. ✅ 修复评估 API 可用
6. ✅ Daily Log API 可用
7. ✅ MemoryReviewer 支持新类型自动整理
8. ✅ 所有测试通过
9. ✅ 与 MEMPALACE 完全独立

---

## 六、注意事项

1. **不要混淆**: 全局核心多层记忆系统 ≠ MEMPALACE
2. **保持独立**: 新功能不依赖 MEMPALACE
3. **向后兼容**: 现有 WarmEntry 类型保持不变
4. **性能优先**: 新功能不显著影响系统性能
5. **文档完整**: 每个新功能都有完整的 API 文档

---

**最后更新**: 2026-05-03
**状态**: 方案设计完成，待实施
