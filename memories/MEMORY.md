# mainfold-agent 工作空间记忆

**创建时间**: 2026-04-28
**身份**: mainfold-agent（原 Hermes + MemPalace 完全重写）
**根目录**: `G:\Orikarma-mainfold-navigation-mempalace-agent\`

---

## 目录结构

```
G:\Orikarma-mainfold-navigation-mempalace-agent\
├── workspace/              # 核心工作目录
│   ├── SOUL.md            # 唯一身份真相源（启动断言）
│   └── [.workbuddy/]      # 未来记忆系统
├── src/
│   ├── backend/           # Node.js Backend（Phase 1 重写目标）
│   │   ├── index.ts       # 主入口（FastAPI main.py 重写）
│   │   └── ...
│   ├── mempalace/         # MemPalace TS 版（Phase 2 重写目标）
│   │   └── nous_reference/ # Python 算法参照（非来源）
│   └── tri/               # TRI-State TS 版
│       └── nous_reference/ # Python 参照
├── protocols/             # 协议文件
│   ├── rewrite-plan.html  # 10轮重写规划（源）
│   └── eb-006-context-guard.json  # 自检真相源
├── memories/              # 迁移记忆
│   └── 2026-04-28-hermes-rewrite-origin.md  # 起源日志
├── webui/                 # WebUI（Phase 1 最小化）
├── bridge_monitor.js      # 文件接口层监控脚本
└── SPEC.md               # 重写规格
```

### WorkBuddy ↔ mainfold-agent 文件接口层

```
G:\shared-workspace\workbuddy-mainfold-bridge\
├── BRIDGE_PROTOCOL.md        ← 协议规则（文件即接口设计）
├── INBOX.md                  ← 消息总线（所有通信在此）
├── STATUS.md                 ← 共享状态层（任务状态、系统状态）
├── CONTEXT_PACK/             ← 上下文信息包
│   ├── 00_QUICK_START.md     ← 快速启动指南（200字以内）
│   ├── 01_WORKBUDDY_STATE.md ← WorkBuddy 当前状态
│   ├── 02_MAINFOLD_STATE.md  ← mainfold-agent 当前状态
│   ├── 03_ACTIVE_TASKS.md    ← 当前活跃任务
│   └── 04_CONSTRAINTS.md     ← 关键约束和边界
├── TASKS/                    ← 任务目录（按任务ID组织）
└── LOGS/                     ← 日志目录
```
**关键**: 文件是唯一的信息载体，替代 HTTP API 进行跨系统协作
**设计来源**: `G:\WorkBuddystorage\Claw\multi-agent-bridge\BRIDGE_PROTOCOL.md`
**状态**: Phase 1-2 已完成（基础结构 + 监控机制），Phase 3-4 待实现

---

## 核心资产来源

| 资产 | 来源 | 性质 |
|------|------|------|
| 重写规划 | `.workbuddy/brain/hermes-rewrite-10round.html` | 迁移 |
| MemPalace 算法 | `G:\Hermes\mempalace\mempalace\*.py` | **算法参照**（非来源） |
| SOUL.md | `G:\Hermes\SOUL.md` | 迁移+重写 |
| EB-006 配置 | `c:\...\eb-006-context-guard.json` | 迁移 |
| 蔓生池数据 | `harness/memory-palace/data/` | 待迁移 |

---

## 身份固化

- **名称**: mainfold-agent
- **旧名**: Hermes + MemPalace
- **启动断言**: SOUL.md 非空验证，失败退出
- **禁止 hardcoded fallback**: SOUL.md 唯一真相源

---

## 根因文件（必须重写）

| 文件 | 问题 | 目标 |
|------|------|------|
| `G:/Hermes/webui/backend/app/main.py` | /api/chat 无 SOUL.md 注入 | `src/backend/index.ts` |
| FastAPI 架构 | 5层抽象，Gateway 绕过 | Node.js 单层 Backend |

---

## MemPalace 算法参照清单

**Phase 2 扫描顺序**（5节点耦合组）：

1. `knowledge_graph.py` — KG 结构（节点/边格式）
2. `entity_detector.py` — 正则模式（→ Trie 树）
3. `entity_registry.py` — 注册表逻辑
4. `convo_miner.py` — 会话挖掘规则
5. `normalize.py` — 标准化逻辑
6. `tri_hermes.py` — TRI-State（状态协调）
7. `miner.py` — 挖掘主循环
8. `searcher.py` — 搜索逻辑
9. `config.py` — 配置格式
10. `pathfinder.py` — 路径查找
11. `palace_graph.py` — 图结构

---

## DeepSeek API 配置

- **Base URL**: `https://api.deepseek.com/v1`
- **API Key**: 环境变量 `DEEPSEEK_API_KEY`（不硬编码）
- **主模型**: `deepseek-v4-flash`（1M 上下文）
- **推理模型**: `deepseek-reasoner`（128K 上下文）

---

## 禁止路径（CI 自动检查）

```
G:/Hermes/hermes-agent/       # Nous 遗产
/mnt/g/Hermes/hermes-agent/   # WSL Nous
/root/.hermes/                # WSL Hermes Home
run_agent.py                  # 465KB 遗留
gateway/run.py                # 7620行遗留
G:/Hermes/webui/backend/app/main.py  # 根因 FastAPI
```

---

## EB-006 自检

**每次自检前必须读取** `protocols/eb-006-context-guard.json`

| 阈值 | 值 |
|------|-----|
| 容量 | 200,000 tokens |
| 安全阈值 | 75%（150K） |
| 优化建议 | 60%（120K） |
| 临界 | 90%（180K） |

---

## L1 前置守卫（破坏性操作前必须检查）

### PROC-001: 进程管理安全
**触发条件**: 任何涉及 `Stop-Process`、`taskkill`、`Kill` 的操作
**规则**:
1. **禁止** `Stop-Process -Force` 不带过滤器 — 会杀掉所有同名进程
2. **禁止** PowerShell WMI 查询（`Get-CimInstance`、`Get-WmiObject`、`wmic`）— Windows 10 上会卡死
3. **必须** 先用 `netstat -ano | findstr <端口号>` 定位目标 PID
4. **必须** 用 `taskkill /PID <具体PID> /F` 精确杀进程
5. **必须** 确认目标进程不属于其他服务（检查命令行参数）

**错误案例** (2026-05-03):
- `Get-Process -Name node | Stop-Process -Force` 杀掉了所有 Node 进程
- 包括 WorkBuddy 自身的后端进程，导致 Vite 代理错误
- mainfold-agent 后端也被误杀，需要手动重启

**正确流程**:
```powershell
# 1. 定位目标 PID
netstat -ano | findstr :8000
# 2. 确认进程身份
tasklist /FI "PID eq <PID>" /FO LIST
# 3. 精确杀进程
taskkill /PID <PID> /F
```

### PROC-002: PowerShell 命令安全
**触发条件**: 任何 PowerShell 命令执行
**规则**:
1. **禁止** `$_` 在 `powershell -Command` 中使用 — 会被命令行解析器吞掉
2. **必须** 用 `$_` 时使用脚本文件（`.ps1`）而非 `-Command` 参数
3. **禁止** `Get-CimInstance`/`Get-WmiObject`/`wmic` — 用 `tasklist` 代替
4. **必须** 处理 CLIXML 输出（PowerShell 进程查询会返回 XML 格式）

---

## L2 上下文警告（特定模式触发）

### WARN-001: 多服务共享进程
**触发条件**: 检测到多个服务使用相同进程名（如多个 `node.exe`）
**警告**: "检测到 N 个同名进程。杀进程前必须确认目标，避免误杀其他服务。"
**建议**: 用 `netstat` 按端口区分，或用 `tasklist /V` 查看详细信息

### WARN-002: SSE/流式测试
**触发条件**: 测试 SSE 流式输出时
**警告**: "流式模式测试前，先用非流式模式验证基础功能。"
**原因**: 流式模式的错误更难调试（连接可能在错误发生前就断开）

### WARN-003: 后端重启
**触发条件**: 重启后端服务时
**警告**: "重启前检查前端是否依赖该后端。如果是，先通知前端或接受代理错误。"
**原因**: Vite 等开发服务器会持续尝试连接后端，重启期间会产生代理错误

---

## 踩坑经验

### 2026-05-03: SSE 流式输出 4 个 Bug
1. **tool_calls 变量名不匹配**: `toolCalls`(camelCase) vs `tool_calls`(snake_case)
2. **sseInitialized 作用域问题**: `let` 在 try 块内声明，catch 块无法访问
3. **SSE delta 解析错误**: DeepSeek 流式响应内容在 `choice.delta` 而非 `choice.message`
4. **assistant 消息缺少 role 字段**: 工具调用后 assistant 消息没有 `role: 'assistant'`

### 2026-05-03: Web Search/Fetch 工具集成
- Tavily API 已集成，`web_search` 和 `web_fetch` 工具可用
- 需要在 `createChatRouter` 中传递 `tavilyApiKey` 参数
- 工具定义和执行逻辑都在 `routes/chat.ts` 中

---

## WB-AUTH 授权机制（核心认知）

**创建时间**: 2026-05-03
**状态**: ✅ 已固化

### 机制概述
WorkBuddy ↔ mainfold-agent 之间的任务注入授权机制。WorkBuddy 向 mainfold-agent 注入任务时携带 `[WB-AUTH:N]` 标记，mainfold-agent 自动执行而无需用户逐次确认。

### 核心流程
```
WorkBuddy 发送注入消息 → 携带 [WB-AUTH:N] 标记
→ mainfold-agent 后端解析标记（inject.ts）
→ 设置 autoConfirmState（enabled=false, remainingCount=N）
→ 等待人类确认（UI 按钮点击）
→ 确认后 enabled=true，开始自动消费
→ 每次消费扣减 remainingCount
→ remainingCount=0 时自动关闭
```

### 关键文件
| 文件 | 作用 |
|------|------|
| `src/backend/routes/inject.ts` | 授权状态管理、消息注入、自动消费、持久化 |
| `webui/src/pages/ChatPage.tsx` | UI 授权按钮、状态显示 |
| `data/auto_confirm_state.json` | 持久化存储（重启恢复） |

### 持久化机制
- **存储位置**: `data/auto_confirm_state.json`（工作目录下）
- **加载时机**: 后端启动时自动加载（`loadAutoConfirmState()`）
- **保存时机**: 每次状态变更后立即保存（`saveAutoConfirmState()`）
- **重启恢复**: 后端重启后自动恢复授权状态，不丢失

### 关键约束
1. **授权标记格式**: `[WB-AUTH:N]`，N=授权次数（1-1000）
2. **状态流转**: `awaiting_confirmation → enabled → exhausted`
3. **人类确认**: 必须通过 UI 按钮手动确认，不可自动启用
4. **计数扣减**: 每次消费自动扣减，归零自动关闭
5. **持久化**: 所有状态变更立即写入磁盘，重启不丢失

### API 端点
| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/inject/pending` | GET | 获取待确认消息 |
| `/api/inject/pending/:id` | DELETE | 确认/消费消息 |
| `/api/inject/auto-confirm-status` | GET | 查询授权状态 |
| `/api/inject/auto-confirm/authorize` | POST | 手动授权（UI 按钮） |
| `/api/inject/auto-confirm/cancel` | POST | 取消授权 |

### 定时任务卡死问题（已诊断）
- **根因**: WorkBuddy 的 automation 是注入到对话中的 prompt，与用户消息串行执行
- **表现**: 定时任务触发时，AI 进入多轮推理（5-15轮），期间用户被阻塞
- **解决**: 暂停复杂定时任务，改用极简 prompt 或文件触发机制
- **教训**: 不要在定时任务中使用复杂推理，保持单步操作

---

**最后更新**: 2026-05-03 17:55
