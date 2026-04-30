# mainfold-agent 完全重写规格

**项目**: Orikarma 流形导航 × MemPalace × mainfold-agent
**版本**: 1.0
**创建时间**: 2026-04-28
**起源**: Hermes + MemPalace Rewrite（基于 10轮流形导航分析）

---

## 目标

将 Hermes + MemPalace 从 Nous Research 遗留架构中**彻底解放**，构建一个：
- **流形导航叙事框架**内化为第一原则
- **MemPalace** 成为 Backend 第一公民（非 MCP 远程）
- **单一.exe** 启动，无 WSL/venv 依赖
- **Node.js Backend** + TypeScript 核心

---

## 三阶段执行规格

### Phase 1 · 止血（8小时）

| Step | 内容 | 时间 |
|------|------|------|
| 1.1 | 新 Backend SOUL.md 加载器：启动断言+幂等缓存+幂等注入到 /api/chat | 30min |
| 1.2 | 扫描 MemPalace Python import：分类（纯标准/Python子进程/可TS替代） | 1h |
| 1.3 | Node.js+Express 骨架：SOUL.md加载+MemPalace SQLite初始化+TRI内存态+/api/chat\|/api/health\|/api/tri | 4h |
| 1.4 | 数据迁移脚本：旧MemPalace JSON → 新SQLite，验证完整性 | 2h |

**根因文件（必须重写）**:
- `G:/Hermes/webui/backend/app/main.py` → `src/backend/index.ts`
- FastAPI `/api/chat` 无 SOUL.md 注入（根因）

### Phase 2 · 重构（2天）

| Step | 内容 | 时间 |
|------|------|------|
| 2.1 | MemPalace TS 化（5节点扫描）：knowledge_graph+entity_detector+convo_miner+normalize → TypeScript | 1天 |
| 2.2 | TRI-State TS 化：内存态+SQLite惰性持久，signal机制保留 | 3h |
| 2.3 | WSL 消除：停止 Hermes Gateway，验证新 Backend 接管 | 4h |

### Phase 3 · 完善（3天）

| Step | 内容 | 时间 |
|------|------|------|
| 3.1 | 流形导航内化：非独立模块，SOUL.md 叙事结构 + 5锚点注入模板 | 1天 |
| 3.2 | MCP Server：MemPalace 查询/实体搜索/话题追踪 | 1天 |
| 3.3 | 打包：pkg/nexe 单一.exe，MemPalace Python 作为 Node.js addon | 1天 |

---

## 耦合群（5节点边界）

### 耦合群 A — 状态协调（TRI-State）
`tri_hermes.py` ⟷ `tri_state.json` ⟷ `health_ratio_control` ⟷ `signal()` ⟷ `_auto_adjust()`
→ 重构方向：内存优先+惰性持久，信号驱动

### 耦合群 B — 身份注入（根因）
`prompt_builder.py` ⟷ `SOUL.md` ⟷ `run_agent.py` ⟷ `run.py(Gateway)` ⟷ `_FALLBACK_IDENTITY`
→ 重构方向：Backend 单层，启动断言，幂等注入

### 耦合群 C — MemPalace（核心资产）
`knowledge_graph.py` ⟷ `entity_registry` ⟷ `entity_detector` ⟷ `convo_miner` ⟷ `normalize.py`
→ 重构方向：TypeScript 重写，算法参照 nous_reference/

### 耦合群 D — WebUI API（根因）
`/api/chat` ⟷ `/api/health` ⟷ `provider路由` ⟷ `normalize_model` ⟷ `httpx客户端`
→ 重构方向：ChatRequest 加 system_prompt 字段，Backend 自加载 SOUL.md

### 耦合群 E — 会话记忆
`session_history` ⟷ `memory_tool` ⟷ `session_search` ⟷ `MEMORY.md` ⟷ `builtin_memory_provider`
→ 重构方向：内存 LRU 缓存（1M 窗口），持久化目标改为 MemPalace KG

---

## 核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Backend语言 | **Node.js** | WebUI同构，JSON原生，Windows原生 |
| 记忆存储 | **SQLite** | JSON太慢，纯内存丢数据 |
| API注入 | **幂等转换** | SOUL.md→system_prompt单次+缓存 |
| MemPalace | **内嵌第一公民** | 不再MCP远程，零网络开销 |
| 启动方式 | **单一.exe** | 消除WSL+venv所有环境依赖 |
| 真相源 | **SOUL.md+MemPalace KG+TRI** | hermes-core.json废弃 |

---

## 禁止路径（固化规则）

```bash
# CI 自动检查，禁止出现在 src/ 任何文件：
G:/Hermes/hermes-agent/
/mnt/g/Hermes/hermes-agent/
/root/.hermes/
run_agent.py
gateway/run.py
G:/Hermes/webui/backend/app/main.py
```

---

## EB-006 自检参数

| 参数 | 值 |
|------|-----|
| 窗口容量 | 200,000 tokens |
| 安全阈值 | 75%（150K） |
| 优化建议 | 60%（120K） |
| 临界值 | 90%（180K） |

---

## 验收标准

### Phase 1 验收
- [ ] 新 Backend 接管 WebUI
- [ ] Agent 自我认知正确（mainfold-agent，非 DeepSeek）
- [ ] TRI-State 状态可见
- [ ] 流形导航叙事正常注入

### Phase 2 验收
- [ ] WSL 关闭
- [ ] MemPalace TS 正常
- [ ] TRI-State 响应

### Phase 3 验收
- [ ] 单一.exe 启动
- [ ] MemPalace 记忆检索正常
- [ ] MCP Server 可调用

---

*基于 hermes-rewrite-10round.html 10轮流形导航分析固化*
