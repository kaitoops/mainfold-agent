/**
 * normalize.ts — Convert any conversation input to normalized transcript format.
 *
 * Logic extracted from nous_reference/normalize.py + convo_miner.py
 *
 * Supports:
 *   - Plain text with > markers (pass through)
 *   - JSON with messages array (basic role/content structure)
 *   - Plain text (pass through)
 */

// ── Types ──

export interface Chunk {
  content: string;
  chunkIndex: number;
  memoryType?: string;
}

// ── Topic keywords for room detection (from convo_miner.py) ──

const TOPIC_KEYWORDS: Record<string, string[]> = {
  technical: [
    'code', 'python', 'function', 'bug', 'error', 'api', 'database',
    'server', 'deploy', 'git', 'test', 'debug', 'refactor',
  ],
  architecture: [
    'architecture', 'design', 'pattern', 'structure', 'schema',
    'interface', 'module', 'component', 'service', 'layer',
  ],
  planning: [
    'plan', 'roadmap', 'milestone', 'deadline', 'priority',
    'sprint', 'backlog', 'scope', 'requirement', 'spec',
  ],
  decisions: [
    'decided', 'chose', 'picked', 'switched', 'migrated',
    'replaced', 'trade-off', 'alternative', 'option', 'approach',
  ],
  problems: [
    'problem', 'issue', 'broken', 'failed', 'crash',
    'stuck', 'workaround', 'fix', 'solved', 'resolved',
  ],
};

const MIN_CHUNK_SIZE = 30;

// ══════════════════════════════════════════════════════════════════
// Core
// ══════════════════════════════════════════════════════════════════

/**
 * Normalize content to transcript format.
 * If content has > markers, pass through.
 * If JSON with messages, extract conversation.
 * Otherwise pass through unchanged.
 */
export function normalize(content: string): string {
  if (!content.trim()) return content;

  // Already has > markers — pass through
  const lines = content.split('\n');
  const quoteCount = lines.filter(l => l.trim().startsWith('>')).length;
  if (quoteCount >= 3) return content;

  // Try JSON normalization
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const normalized = tryNormalizeJson(parsed);
      if (normalized) return normalized;
    } catch {
      // Not valid JSON, pass through
    }
  }

  return content;
}

/**
 * Try to normalize JSON chat data to transcript format.
 */
function tryNormalizeJson(data: any): string | null {
  // Array of messages: [{role, content}, ...]
  if (Array.isArray(data)) {
    return extractMessages(data);
  }

  // Object with messages/chat_messages array
  if (typeof data === 'object' && data !== null) {
    const msgs = data.messages ?? data.chat_messages ?? [];
    if (Array.isArray(msgs) && msgs.length > 0) {
      return extractMessages(msgs);
    }
  }

  return null;
}

/**
 * Extract conversation from messages array.
 */
function extractMessages(data: any[]): string | null {
  const messages: Array<{ role: string; text: string }> = [];

  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;

    // Support nested chat_messages (privacy export format)
    const chatMsgs = item.chat_messages;
    if (Array.isArray(chatMsgs)) {
      for (const msg of chatMsgs) {
        const role = msg.role ?? '';
        const text = extractText(msg.content);
        if ((role === 'user' || role === 'human') && text) {
          messages.push({ role: 'user', text });
        } else if ((role === 'assistant' || role === 'ai') && text) {
          messages.push({ role: 'assistant', text });
        }
      }
      continue;
    }

    const role = item.role ?? '';
    const text = extractText(item.content);
    if ((role === 'user' || role === 'human') && text) {
      messages.push({ role: 'user', text });
    } else if ((role === 'assistant' || role === 'ai') && text) {
      messages.push({ role: 'assistant', text });
    }
  }

  if (messages.length < 2) return null;
  return messagesToTranscript(messages);
}

/**
 * Pull text from content — handles string, array of blocks, or object.
 */
function extractText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item?.type === 'text') return item.text ?? '';
        return '';
      })
      .join(' ')
      .trim();
  }
  if (typeof content === 'object' && content !== null) {
    return (content.text ?? '').trim();
  }
  return '';
}

/**
 * Convert [(role, text), ...] to transcript format with > markers.
 */
function messagesToTranscript(messages: Array<{ role: string; text: string }>): string {
  const lines: string[] = [];
  let i = 0;

  while (i < messages.length) {
    const { role, text } = messages[i];

    if (role === 'user') {
      lines.push(`> ${text}`);
      // Next message is assistant — append inline
      if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
        lines.push(messages[i + 1].text);
        i += 2;
      } else {
        i += 1;
      }
    } else {
      lines.push(text);
      i += 1;
    }

    lines.push(''); // blank line between turns
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// Chunking
// ══════════════════════════════════════════════════════════════════

/**
 * Chunk content by exchange pair: one > turn + AI response = one unit.
 * Falls back to paragraph chunking if no > markers.
 */
export function chunkExchanges(content: string): Chunk[] {
  const lines = content.split('\n');
  const quoteCount = lines.filter(l => l.trim().startsWith('>')).length;

  if (quoteCount >= 3) {
    return chunkByExchange(lines);
  }
  return chunkByParagraph(content);
}

function chunkByExchange(lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('>')) {
      const userTurn = line;
      i += 1;

      const aiLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i].trim();
        if (next.startsWith('>') || next.startsWith('---')) break;
        if (next) aiLines.push(next);
        i += 1;
      }

      const aiResponse = aiLines.slice(0, 8).join(' ');
      const content = aiResponse ? `${userTurn}\n${aiResponse}` : userTurn;

      if (content.trim().length > MIN_CHUNK_SIZE) {
        chunks.push({ content, chunkIndex: chunks.length });
      }
    } else {
      i += 1;
    }
  }

  return chunks;
}

function chunkByParagraph(content: string): Chunk[] {
  const paragraphs = content
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p);

  // If no paragraph breaks and long content, chunk by line groups
  if (paragraphs.length <= 1 && content.split('\n').length > 20) {
    const lines = content.split('\n');
    const groups: Chunk[] = [];
    for (let i = 0; i < lines.length; i += 25) {
      const group = lines.slice(i, i + 25).join('\n').trim();
      if (group.length > MIN_CHUNK_SIZE) {
        groups.push({ content: group, chunkIndex: groups.length });
      }
    }
    return groups;
  }

  return paragraphs
    .filter(p => p.length > MIN_CHUNK_SIZE)
    .map(p => ({ content: p, chunkIndex: 0 }));
}

// ══════════════════════════════════════════════════════════════════
// Room Detection
// ══════════════════════════════════════════════════════════════════

/**
 * Score conversation content against topic keywords.
 */
export function detectConvoRoom(content: string): string {
  const sample = content.slice(0, 3000).toLowerCase();
  const scores: Record<string, number> = {};

  for (const [room, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.filter(kw => sample.includes(kw)).length;
    if (score > 0) scores[room] = score;
  }

  if (Object.keys(scores).length === 0) return 'general';

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}
