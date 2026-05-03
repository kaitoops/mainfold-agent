/**
 * patch-chat.js — 对 chat.ts 做两处精确插入
 *
 * 插入1: import 区域（getSelfScanToolDefinition 后）→ 导入 appendMessage
 * 插入2: Step 7.5 之后 → 消息文件持久化
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'routes', 'chat.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// ── 插入1: import 区域 ──
const importAnchor = "import { getSelfScanToolDefinition } from './self-scan.js';";
const importInsert = `import { getSelfScanToolDefinition } from './self-scan.js';

// ── 消息持久化（单一持久化源）──

import { appendMessage } from './messages.js';`;

if (content.includes(importInsert)) {
  console.log('[patch] Import already patched, skipping.');
} else if (content.includes(importAnchor)) {
  content = content.replace(importAnchor, importInsert);
  console.log('[patch] Import patched successfully.');
} else {
  console.error('[patch] ERROR: Import anchor not found!');
  process.exit(1);
}

// ── 插入2: Step 7.5 之后，// 8. 返回 之前 ──
const step75End = `          console.error(\`[chat] Cold memory log failed: \${(err as Error).message}\`);
        }
      }

      // 8. 返回`;
const persistBlock = `          console.error(\`[chat] Cold memory log failed: \${(err as Error).message}\`);
        }
      }

      // 7.6 Phase F: 消息文件持久化（单一持久化源，替代 localStorage + sessions.json 双写）
      if (session_id && typeof cleanedMessage === 'string' && finalContent) {
        try {
          const timestamp = new Date().toISOString();
          appendMessage(session_id, {
            id: \`msg_\${Date.now()}_user\`,
            role: 'user',
            content: String(cleanedMessage),
            timestamp,
            source: 'user',
            senderModel: normalizedModel,
          }, { title: \`对话 \${new Date().toLocaleDateString()}\`, model: normalizedModel });
          appendMessage(session_id, {
            id: \`msg_\${Date.now()}_assistant\`,
            role: 'assistant',
            content: finalContent,
            reasoning_content: finalReasoning,
            timestamp,
            token_used: totalTokens,
            tool_call_depth: toolCallDepth,
            senderModel: normalizedModel,
          });
          console.log(\`[chat] Messages persisted to data/messages/ (\${session_id})\`);
        } catch (err) {
          console.error(\`[chat] Message persist failed: \${(err as Error).message}\`);
        }
      }

      // 8. 返回`;

if (content.includes(persistBlock)) {
  console.log('[patch] Persist block already patched, skipping.');
} else if (content.includes(step75End)) {
  content = content.replace(step75End, persistBlock);
  console.log('[patch] Persist block patched successfully.');
} else {
  console.error('[patch] ERROR: Step 7.5 anchor not found!');
  process.exit(1);
}

// ── 写入 ──
fs.writeFileSync(filePath, content, 'utf-8');
console.log('[patch] chat.ts patched successfully.');
