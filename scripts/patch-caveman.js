/**
 * Caveman 集成补丁脚本
 * 修改 src/backend/routes/chat.ts 的 3 处位置
 */
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'src/backend/routes/chat.ts');
let content = fs.readFileSync(filePath, 'utf-8');
const originalSize = content.length;
let changes = 0;

// ===== Change 1: Add Caveman import =====
const importTarget = `import type { ColdMemory } from '../memory/cold-db.js';`;
const importReplacement = `import type { ColdMemory } from '../memory/cold-db.js';

// ── CAVEMAN: 洞穴人角色切换模式 ──

import { getCavemanCore, getCavemanPromptPatch, handleCavemanCommand, containsCavemanCommand, parseCavemanCommand } from '../services/caveman.js';`;

if (content.includes(importTarget) && !content.includes('caveman.js')) {
  content = content.replace(importTarget, importReplacement);
  console.log('Change 1 (import): OK');
  changes++;
} else {
  console.log('Change 1 (import): SKIPPED - ' + (content.includes('caveman.js') ? 'already exists' : 'target not found'));
}

// ===== Change 2: Add caveman command processing =====
const cmdTarget = `      // 3. 构建 system prompt（含 SICR 种子引力场 + ESA 注意力状态）`;

const cmdReplacement = `      // ── Caveman 命令处理 ──
      if (typeof cleanedMessage === 'string' && containsCavemanCommand(cleanedMessage)) {
        const cavemanResponse = handleCavemanCommand(cleanedMessage);
        if (cavemanResponse) {
          const cavemanCore2 = getCavemanCore();
          const level = cavemanCore2.getLevel();
          if (level !== 'off') {
            console.log('[chat] Caveman activated: ' + level);
          }
          // 直接返回确认消息（跳过 AI 调用）
          if (isStreaming) {
            initSSE();
            sendSSE('caveman', { content: cavemanResponse });
            sendSSE('done', {
              content: cavemanResponse,
              token_used: 0,
              finish_reason: 'stop',
              timestamp: new Date().toISOString(),
            });
            res.end();
          } else {
            res.json({
              content: cavemanResponse,
              token_used: 0,
              finish_reason: 'stop',
              timestamp: new Date().toISOString(),
            });
          }
          resetAgentStatus();
          return;
        }
      }

      // 3. 构建 system prompt（含 SICR 种子引力场 + ESA 注意力状态）`;

if (content.includes(cmdTarget) && !content.includes('Caveman 命令处理')) {
  content = content.replace(cmdTarget, cmdReplacement);
  console.log('Change 2 (command handling): OK');
  changes++;
} else {
  console.log('Change 2 (command handling): SKIPPED - ' + (content.includes('Caveman 命令处理') ? 'already exists' : 'target not found'));
}

// ===== Change 3: Add caveman prompt injection =====
const promptTarget = `      // 【根因修复】：注入 system_prompt 作为第一条消息`;

const promptReplacement = `      // ── Caveman prompt 补丁注入 ──
      const cavemanCore3 = getCavemanCore();
      if (cavemanCore3.isActive()) {
        const cavemanPatch = getCavemanPromptPatch(cavemanCore3.getLevel());
        if (cavemanPatch) {
          fullSystemPrompt += '\n\n' + cavemanPatch;
          console.log('[chat] Caveman patch injected: ' + cavemanCore3.getLevel());
        }
      }

      // 【根因修复】：注入 system_prompt 作为第一条消息`;

if (content.includes(promptTarget) && !content.includes('Caveman prompt 补丁注入')) {
  content = content.replace(promptTarget, promptReplacement);
  console.log('Change 3 (prompt injection): OK');
  changes++;
} else {
  console.log('Change 3 (prompt injection): SKIPPED - ' + (content.includes('Caveman prompt 补丁注入') ? 'already exists' : 'target not found'));
}

// Write
fs.writeFileSync(filePath, content, 'utf-8');
console.log('\nDone: ' + changes + ' changes applied');
console.log('Size: ' + originalSize + ' -> ' + content.length + ' bytes');
