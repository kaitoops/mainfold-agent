# 2026-04-28

## Hermes 自我认知更新 ✅

### 问题诊断
- Hermes Agent 对话中出现错误认知："无外部 LLM 连接"、"依赖本机计算资源推理"
- 这些是过时的 Nous Research 遗留描述

### 解决方案
1. **创建 SOUL.md** (`G:\Hermes\SOUL.md`)
   - 真实架构: LLM = DeepSeek V4 Flash API（不依赖本机）
   - 本地只执行工具: memory, session_search, query_topic, execute_code
   - 组件结构: hermes-agent/, webui/, mempalace/, hermes-core.json

2. **更新 DEFAULT_AGENT_IDENTITY** (`hermes-agent/agent/prompt_builder.py`)
   - 从 SOUL.md 动态加载，不硬编码
   - 添加 `_load_default_identity()` 函数
   - Fallback 到 `_FALLBACK_IDENTITY`

3. **复制到 HERMES_HOME** (`C:/Users/WIN10/.hermes/SOUL.md`)
   - Hermes Agent 从 `~/.hermes/SOUL.md` 加载身份

### 关键事实（基于重构历史）
- 根目录: `G:\Hermes`
- LLM: DeepSeek V4 Flash (主, 1M上下文) + DeepSeek R1 (深度推理)
- API Key: `sk-6719764a4db84c84b3e30fa77abae667`（2026-04-28 22:49 更新，原 key 已作废）
- **重要架构事实**: Hermes Gateway 运行在 WSL，读取 `/root/.hermes/` 下的配置，与 Windows `G:\Hermes\` 文件独立。配置更新必须同时修改两边并重启 Gateway。
- hermes-core.json v1.1.0 (单一真相源)

## Hermes Thinking 过程可见化 ✅

- 后端 `main.py` 修改：
  - `ChatResponse` 添加 `reasoning_content: Optional[str]` 字段
  - `/api/chat` 端点提取 `message.reasoning_content` 并返回
- 前端 `ChatPage.tsx` 修改：
  - `Message` 类型添加 `reasoning_content?: string`
  - 添加 `expandedThinking` 状态管理
  - 添加 `toggleThinking()` 展开/收起函数
  - 添加 Thinking UI 渲染（紫色背景卡片）
- **关键设计**：从实际输出判断，而非硬编码模型列表
  - DeepSeek V4 Flash 也可能返回 reasoning_content
  - 前端只检查 `msg.reasoning_content` 是否存在
- 测试验证通过：`deepseek-v4-flash` 和 `deepseek-reasoner` 均正常工作

## Nous Research 残留清理 + 自定义 fallback 模板 ✅

### 操作结果
- **会话历史**：WSL `/root/.hermes/sessions/` 全部清空（34 个文件 → 0）
- **fallback 模板**：已重写为纯 Hermes + MemPalace 身份，移除所有 Nous Research 引用
- **修改的文件**：
  - `hermes_cli/default_soul.py` — 自定义 fallback（Windows + WSL）
  - `hermes_cli/banner.py` — Banner 中 Nous Research → "Hermes + MemPalace"
  - `hermes_cli/cli.py` — 3 处 Nous Research 字符串替换
- **Gateway 重启**：PID 1091，健康运行

### 自定义 fallback 模板内容
> "You are Hermes + MemPalace, a persistent AI agent built on a MemPalace (associative memory) architecture. You operate from a structured workspace and use DeepSeek V4 API as your inference engine. Your identity, capabilities, and operating principles are defined in your SOUL.md. If this file is unreadable, fall back to: persistent memory across sessions, clear communication, genuine helpfulness over verbosity, and DeepSeek V4 inference."

### 下一步验证
- 打开 Hermes WebUI → 新建对话 → 确认 Agent 自我认知为"Hermes + MemPalace"，不再提及 Nous Research



### 根因分析（关键！）

**双文件架构**：
- Windows 端: `G:\Hermes\` 文件（之前只改了这里）
- WSL 端: `/root/.hermes/` 文件（**实际运行读取这里，之前完全被忽略**）
- Hermes Gateway PID 780 → 916，重启后生效

### 更新的文件

#### Windows 端（`G:\Hermes\`）
| 文件 | 变更 |
|------|------|
| `hermes-core.json` | API Key + provider + 上下文 1M |
| `hermes-autonomy-config.json` | model V3 → V4 |
| `hermes-agent/agent/model_metadata.py` | V4 上下文长度 |
| `hermes-agent/config.yaml` | API Key + 模型描述 |
| `SOUL.md` | API Key 更新 |

#### WSL 端（`/root/.hermes/`）
| 文件 | 变更 |
|------|------|
| `config.yaml` | `model.default: deepseek-ai/DeepSeek-V3` → `deepseek-ai/deepseek-v4-pro` |
| `SOUL.md` | 同步 Windows 端版本（新的正确身份） |

### V4 模型规格
- **模型 ID**: `deepseek-v4-pro` (主) / `deepseek-v4-flash` (轻量)
- **上下文窗口**: 1M tokens
- **Gateway PID**: 916 (重启后)

### 关键教训
以后修改 Hermes 配置必须同时修改 WSL 端！Windows 文件只是备份。

## agent-browser 固化

- 安装 agent-browser v0.26.0（npm 全局包）
- 验证 Edge 浏览器可用（Chrome 权限问题绕过）
- 成功操作 localhost:3000 (Hermes + MemPalace WEBUI)
- 固化到 MEMORY.md 层二：技术偏好 + agent-browser 详细说明
- **高频使用场景**: WEBUI 操作、页面内容提取、截图采集

## Hermes 自检机制修复 ✅

### 问题诊断
- Agent 生成的自检报告包含错误信息："外部LLM仍不可用（API key缺失）"
- 综合健康度 88/100 疑似捏造
- 根本原因：Agent 没有读取 hermes-core.json 中的真实系统状态

### L0 元层诊断
- 自检报告是 **Agent 通过 LLM 动态生成**的，不是硬编码
- Agent 的评估基于它能访问的信息，而这些信息可能不准确
- SOUL.md 提供了身份认知，但缺少系统状态真相源

### 解决方案
1. **创建 system_status.md** (`G:\Hermes\system_status.md`)
   - 基于 hermes-core.json 的实时系统状态
   - 包含 API 连接状态、TRI-Hermes 健康度、模块状态
   - 定义标准评分维度和报告格式

2. **创建 HERMES.md** (`G:\Hermes\HERMES.md`)
   - 被 prompt_builder._load_hermes_md() 自动加载
   - 引用 system_status.md 作为真相源

3. **更新 SOUL.md**
   - 添加"自检协议"章节
   - 明确要求读取 system_status.md
   - 禁止捏造数据和错误认知

4. **复制到 HERMES_HOME**
   - SOUL.md, HERMES.md, system_status.md → `C:/Users/WIN10/.hermes/`

### 修复后的自检行为
- Agent 必须读取 `G:\Hermes\system_status.md`
- 使用真实 API 状态（TRI-Hermes 健康度 0.5）
- 评分必须基于实际工具可用性
- 禁止声称"API key 缺失"（已配置）

## Hermes 自检协议体系移植 ✅

### 移植来源
WORKBUZZDY EB-006 自检机制：
- 真相源文件机制
- 5 步 SOP 流程
- 禁止捏造数据规则

### 新增文件

| 文件 | 路径 | 用途 |
|------|------|------|
| `self_check.md` | `G:\Hermes\hermes-agent\prompts\self_check.md` | **自我检查 SOP** - 核心真相源 |
| `startup_protocol.md` | `G:\Hermes\hermes-agent\prompts\startup_protocol.md` | **启动自检协议** |

### 自检 SOP（5 步）

1. **读取 self_check.md** - 获取最新 SOP（优先级 1）
2. **扫描文件系统** - 验证核心文件存在
3. **检查 API 连接** - DeepSeek API + 服务状态
4. **计算评分** - 基于真实数据
5. **生成报告** - 结构化输出

### 部署位置

所有文件已复制到 `C:/Users/WIN10/.hermes/`:
- `SOUL.md`
- `self_check.md`
- `startup_protocol.md`
- `system_status.md`
- `HERMES.md`

## HERMES WSL 验证机制固化 ✅

### 创建文件
1. **HERMES 注册表** (`.workbuddy/hermes_registry.json`)
   - 记录所有 HERMES 实例及其运行环境
   - 当前实例: `default` (WSL Ubuntu-22.04)
   - 支持多实例扩展

2. **WSL 验证脚本** (`.workbuddy/tools/hermes_wsl_validator.py`)
   - 实时验证 WSL 状态
   - 检查 WSL 中 config.yaml 存在性
   - 输出 JSON 格式供程序调用
   - 关键操作前必须调用

### 验证决策流程
```
关键操作?
    ↓
读取 hermes_registry.json
    ↓
running_on_wsl == true? → 调用验证脚本 → 检查 WSL 状态 + config.yaml
running_on_wsl == false? → 直接使用 Windows 路径
```

### 踩坑记录
- WSL `wsl -l -v` 输出是 UTF-16 编码（带空字节），需用 `utf-16-le` 解码
- WSL 中没有 `bash`，需用 `wsl.exe -d Ubuntu -- sh -c ...`

## Hermes + MemPalace Rewrite 决策落地 ✅

### 最终裁决：Rewrite（非Fix）

**核心判断**：Fix的TOKEN成本长期看更高，Nous遗产的认知税无法消除。重写本质是把MemPalace从Nous框架里解放出来。

### 10轮流形导航分析（文档：`.workbuddy/brain/hermes-rewrite-10round.html`）

| Round | 内容 | 关键产出 |
|-------|------|---------|
| 1 | 架构分解L0 | 132工具中127个是债务，只有5个核心工具 |
| 2 | 用户需求 | 主人需求≠WebUI用户需求，前者为第一优先级 |
| 3 | 约束识别 | 4个伪约束已打破（WSL/skill生态/Gateway/hermes-core） |
| 4 | 失效模式 | 根因：今晚sed截断WSL config.yaml导致5层抽象全部失效 |
| 5 | 生态位 | Hermes+MemPalace是WORKBUDDY的"记忆+推理执行引擎" |
| 6 | 决策空间 | 推荐Node.js+SQLite+幂等注入+MemPalace内嵌+单一.exe |
| 7 | 假设质疑 | 流形导航不是独立模块，是SOUL.md的叙事原则 |
| 8 | 架构合成 | 新架构：Backend单层+MemPalace第一公民+无WSL |
| 9 | 对抗压测 | 5个攻击场景+防御策略 |
| 10 | 执行规格 | Phase1止血(8h)→Phase2重构(2天)→Phase3完善(3天) |

### 5节点耦合扫描（固化规则）

- 耦合群A（状态）：tri_hermes.py↔hermes-core.json↔health_ratio_control↔signal()↔_auto_adjust
- 耦合群B（身份）：prompt_builder.py↔SOUL.md↔run_agent.py↔run.py↔_FALLBACK_IDENTITY（根因所在）
- 耦合群C（MemPalace）：knowledge_graph.py↔entity_registry↔entity_detector↔convo_miner↔normalize.py
- 耦合群D（WebUI API）：/api/chat↔/api/health↔provider选择↔normalize_model↔httpx（根因所在）
- 耦合群E（会话）：session_history↔memory_tool↔session_search↔MEMORY.md↔builtin_memory_provider

### 4条固化规则（禁止遗留代码渗透）

1. **5节点扫描协议**：每次扫描→找耦合→理解目标→完全重构→算法等价性测试
2. **禁止路径**：hermes-agent/、WSL /root/.hermes/、run_agent.py、gateway/run.py（CI自动扫描）
3. **MemPalace例外**：Python文件是参照非来源，禁止复制粘贴
4. **SOUL.md守卫**：唯一身份来源，启动时断言，禁止hardcoded fallback

### 新架构关键决策

- Backend语言：Node.js（与WebUI同构，Windows原生）
- 记忆存储：SQLite+MemPalace索引（hermes-core.json废弃）
- MemPalace：内嵌为第一公民（非MCP远程）
- 启动：单一.exe（消除WSL+venv+Python依赖）
- 真相源：SOUL.md+MemPalace KG+TRI-Hermes状态

