# 心流种子引力场 × 测地线导航对接方案

**版本**: v1.0 | **日期**: 2026-04-30 | **状态**: 设计文档

---

## 一、核心问题

心流种子（flow_seed）在休眠期间如何被当前推理路径"自然命中"？原 Phase 3 设计用 GravityEngine（关键词重叠+语义向量+概念层级）做显式匹配。在 mainfold-agent 中，这个匹配过程可以**内化到已有的测地线导航步骤 6.2 中**。

---

## 二、对接接口（无需额外模块）

### 2.1 数据通道

```
system_prompt 构建时（soul-loader.ts → chat.ts）：
  [现有] SOUL.md body → 注入
  [现有] MemPalace 快照 → 注入
  [新增] 种子上下文（getSeedsAsContext） → 注入
```

### 2.2 种子上下文格式（纯文本，~200 tokens）

```
--- 心流种子 ---
已发芽种子（建议在回答中引用）：
  [seed_a1b2] 我突然觉得，信息增量速率为负的时候，不是失败，是分娩。
    锚点: 信息论, 自指, 熵

休眠种子：
  [seed_c3d4] 艾舍尔的两只手是不是也在说，定义和被定义者之间根本没有先后？
  [seed_e5f6] GEB 的自指逻辑从数学到音乐到绘画的投影不是类比，是同构。
```

### 2.3 触发机制（在 SOUL.md 步骤 6.2 中已定义）

测地线导航步骤 6.2（中观检查）的自然延伸：

```
6.2 中观检查 — 局部梯度与方向一致性检查
  → 同时检查：当前推理路径是否与任一[DORMANT]种子的语义空间接近
  → 如果接近 → 标记为[SPROUTED] → 在回答末尾提示用户
```

这不需要独立引擎——reasoner 在这个步骤中**自然能感知**到上下文中列出的休眠种子是否与当前推理相关。这是 V4-Flash 1M 上下文能力赋予的"本能"。

---

## 三、三阶段引入策略

### Phase 1：纯文本注入（当前已实现）

```
system_prompt 末尾自动追加种子上下文
→ reasoner 自主判断关联性
→ 不需要任何匹配算法
```

### Phase 2：后端主动匹配（可选增强）

```
如果 Phase 1 效果不佳：
  → 在后端 seeds.ts 中加简单关键词索引（基于 content 的分词）
  → 每次 chat 请求时预筛最相关的 3 颗种子
  → 只注入这 3 颗，减少 context 浪费
```

### Phase 3：MemPalace 实体关联（长期）

```
flow_seed 作为 MemPalace 实体类型
→ 利用已有的 entity_registry 的 learnFromText 做自动标注
→ 种子内容中的关键词自动成为 KG 中的语义锚点
→ 通过已有的 graph_query 做关联检索
```

---

## 四、与 WorkBuddy 本体论系统的边界

| 组件 | 归属 | 理由 |
|------|------|------|
| `sustainabilityMonitor` | 本体论 | 纯推理链检测，非对话系统需求 |
| `boundaryDetector` | 本体论 | 同上 |
| `flowStateParser` ([心流]令牌) | **mainfold-agent** ✅ 已注入 SOUL.md | 对话层原生能力 |
| `seedPool` | **mainfold-agent** ✅ 已实现 | MemPalace 扩展实体类型 |
| `gravityEngine` | **mainfold-agent** ✅ 已内化到步骤6.2 | 测地线导航增强版替代 |
| `humanIntegrator` | 两边各有一份 | 设计不同（本体论=边界恢复，mainfold=对话延续） |

---

## 五、下一步

Phase 1 已就绪（SOUL.md + seed route + system_prompt 注入）。
观察实际效果后决定是否需要 Phase 2。
