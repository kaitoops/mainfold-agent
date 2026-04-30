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
└── SPEC.md               # 重写规格
```

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

**最后更新**: 2026-04-28
