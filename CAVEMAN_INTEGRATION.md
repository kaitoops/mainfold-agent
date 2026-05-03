# CAVEMAN 集成到 mainfold-agent 方案

## 一、功能定位

**非必要不调用能力**：用户显式触发时才激活，默认关闭。

触发方式：
- `/caveman` 命令
- "caveman mode" / "talk like caveman" / "less tokens"
- "stop caveman" / "normal mode" 关闭

## 二、架构设计

### 2.1 集成位置

```
mainfold-agent
├── src/backend/
│   ├── routes/chat.ts          ← 修改：添加 caveman 模式判断
│   ├── services/caveman.ts     ← 新增：caveman 核心逻辑
│   └── types/chat.ts           ← 修改：添加 caveman 状态类型
├── webui/src/
│   └── pages/ChatPage.tsx      ← 修改：添加 caveman 状态显示
└── skills/
    └── caveman/                ← 新增：caveman skill 定义
        └── SKILL.md
```

### 2.2 核心模块：caveman.ts

```typescript
// src/backend/services/caveman.ts

export type CavemanLevel = 'off' | 'lite' | 'full' | 'ultra' | 'wenyan';

export interface CavemanState {
  active: boolean;
  level: CavemanLevel;
  activatedAt?: string;
  tokenSaved?: number;
}

// Caveman 压缩规则
const CAVEMAN_RULES: Record<CavemanLevel, string> = {
  off: '',
  lite: 'Drop filler/hedging. Keep articles + full sentences. Professional but tight.',
  full: 'Drop articles, fragments OK, short synonyms. Classic caveman. Pattern: [thing] [action] [reason]. [next step].',
  ultra: 'Abbreviate prose words (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y), one word when one word enough. Code symbols never abbreviate.',
  'wenyan-lite': 'Semi-classical. Drop filler/hedging but keep grammar structure, classical register.',
  'wenyan-full': 'Maximum classical terseness. Fully 文言文. 80-90% character reduction. Classical sentence patterns, verbs precede objects, subjects often omitted.',
  'wenyan-ultra': 'Extreme abbreviation while keeping classical Chinese feel. Maximum compression, ultra terse.',
};

// 生成 caveman system prompt 补丁
export function getCavemanPromptPatch(level: CavemanLevel): string {
  if (level === 'off') return '';
  
  const rules = CAVEMAN_RULES[level];
  return `
## CAVEMAN MODE ACTIVE (${level.toUpperCase()})
${rules}

CRITICAL RULES:
- Drop: articles (a/an/the), filler (just/really/basics/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging
- Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for")
- Technical terms exact. Code blocks unchanged. Errors quoted exact.
- Pattern: [thing] [action] [reason]. [next step].
- NOT: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
- YES: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"

AUTO-CLARITY: Drop caveman for security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread.
`;
}

// 解析用户命令
export function parseCavemanCommand(message: string): { command: string; level?: CavemanLevel } | null {
  const lower = message.toLowerCase().trim();
  
  // 关闭命令
  if (lower === 'stop caveman' || lower === 'normal mode') {
    return { command: 'stop' };
  }
  
  // 激活命令
  if (lower === 'caveman' || lower === 'caveman mode' || lower === 'talk like caveman' || lower === 'less tokens') {
    return { command: 'start', level: 'full' };
  }
  
  // 带级别的激活命令
  const levelMatch = lower.match(/\/caveman\s+(lite|full|ultra|wenyan|wenyan-lite|wenyan-full|wenyan-ultra)/);
  if (levelMatch) {
    return { command: 'start', level: levelMatch[1] as CavemanLevel };
  }
  
  return null;
}
```

### 2.3 集成到 chat.ts

```typescript
// 在 chat() 函数中添加 caveman 状态管理

let cavemanState: CavemanState = { active: false, level: 'off' };

// 在处理用户消息时解析 caveman 命令
const cavemanCmd = parseCavemanCommand(req.body.message);
if (cavemanCmd) {
  if (cavemanCmd.command === 'stop') {
    cavemanState = { active: false, level: 'off' };
  } else if (cavemanCmd.command === 'start' && cavemanCmd.level) {
    cavemanState = { 
      active: true, 
      level: cavemanCmd.level,
      activatedAt: new Date().toISOString()
    };
  }
}

// 在构建 system prompt 时添加 caveman 补丁
const cavemanPatch = getCavemanPromptPatch(cavemanState.level);
if (cavemanPatch) {
  systemPrompt += cavemanPatch;
}
```

### 2.4 前端状态显示

在 ChatPage.tsx 添加 caveman 状态指示器：
- 显示当前模式（off/lite/full/ultra/wenyan）
- 显示预估节省的 token 数
- 提供快速切换按钮

## 三、观察机制

### 3.1 修复过程观察

记录移植过程中的摩擦点：
- 文件修改次数
- 代码变更行数
- 首次成功率
- 死循环/无效操作次数

### 3.2 效果评估

移植后评估：
- 实际 token 节省比例
- 用户满意度
- 是否引入回归问题

## 四、实施步骤

1. 创建 `src/backend/services/caveman.ts`
2. 修改 `src/backend/routes/chat.ts` 集成 caveman 逻辑
3. 修改 `webui/src/pages/ChatPage.tsx` 添加状态显示
4. 创建 `skills/caveman/SKILL.md`
5. 测试各种压缩级别
6. 记录修复过程和效果评估

## 五、注意事项

- **非必要不调用**：默认关闭，用户显式触发才激活
- **持久化**：激活后每轮响应都生效，直到用户关闭
- **自动清晰度**：安全警告、不可逆操作时自动切换回正常模式
- **不影响推理**：只压缩输出 token，不影响 thinking/reasoning tokens
