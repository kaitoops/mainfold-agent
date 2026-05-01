/**
 * mainfold-agent — SICR 路由模块
 *
 * Scaffolded In-Context Retrieval 路由层
 *
 * 核心原理：用 V4-Flash 的 1M 上下文窗口替代向量检索。
 * 将候选池和查询同时放入上下文，利用 Transformer
 * Attention 头（softmax(QK^T)）天然计算相似度的特性，
 * 通过 prompt 结构设计控制注意力分配。
 *
 * 适用条件：候选池 < 200 条，单次 SICR ~1K-10K Token
 *
 * 模块组成：
 *   rankCandidates()    — 核心 SICR 函数（可被其他模块导入）
 *   createSicrRouter()  — Express 路由器
 *   SicrLogger          — low-confidence 日志层
 *
 * 可用端点：
 *   POST /api/sicr/search  — 通用语义搜索
 *   GET  /api/sicr/stats   — SICR 调用统计
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** SICR 候选条目 */
export interface SicrCandidate {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** SICR 排好序的结果 */
export interface SicrRankedResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** SICR 请求参数 */
export interface SicrRequest {
  query: string;
  candidates: SicrCandidate[];
  topK?: number;
  minScore?: number;
  includeReasoning?: boolean;
}

/** SICR 响应 */
export interface SicrResponse {
  query: string;
  results: SicrRankedResult[];
  totalCandidates: number;
  tokensUsed: number;
  confidence: 'high' | 'medium' | 'low';
  latencyMs: number;
  reasoning?: string;
}

/** low-confidence 日志事件 */
interface SicrLogEvent {
  timestamp: string;
  query: string;
  candidateCount: number;
  topK: number;
  maxScore: number;
  minScore: number;
  meanScore: number;
  confidence: 'high' | 'medium' | 'low';
  anomalyFlags: string[];
}

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SCORE = 0.3;
const MAX_CANDIDATES = 200;
const LOG_DIR = path.resolve(process.env.CONFIG_DIR || 'config', 'sicr-logs');

/** 低置信度阈值 */
const CONFIDENCE_THRESHOLDS = {
  HIGH_MIN: 0.7,      // 最高分 >= 0.7
  MEDIUM_MIN: 0.4,    // 最高分 >= 0.4
  SPREAD_MIN: 0.2,    // 分数跨度 >= 0.2 才算有区分度
} as const;

// ══════════════════════════════════════════════════════════════════
// SICR Prompt 模板
// ══════════════════════════════════════════════════════════════════

const SICR_SYSTEM_PROMPT = `You are a semantic relevance ranker.
Your task: given a search query and a list of candidates, rank each candidate by how semantically relevant it is to the query.

Rules:
- Score each candidate from 0.0 (completely unrelated) to 1.0 (perfect match)
- Use semantic similarity, not keyword matching
- Be discriminative: use the full 0.0–1.0 range
- Only include candidates with score >= 0.3
- Output exactly in the format shown below
- Do NOT add any commentary or explanation outside the ranking block

Output format:
[RANKING]
1. id: <candidate_id>, score: <0.0-1.0>
2. id: <candidate_id>, score: <0.0-1.0>
[/RANKING]`;

// ══════════════════════════════════════════════════════════════════
// SICR 核心函数
// ══════════════════════════════════════════════════════════════════

/**
 * 使用 V4-Flash 1M 上下文进行语义排序。
 *
 * @param query   搜索查询
 * @param candidates  候选条目池（最多 200 条）
 * @param options     topK, minScore 等
 * @returns 排好序的结果
 */
export async function rankCandidates(
  query: string,
  candidates: SicrCandidate[],
  options?: {
    topK?: number;
    minScore?: number;
    includeReasoning?: boolean;
  },
): Promise<SicrResponse> {
  const startTime = Date.now();
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;

  // 边界保护
  if (!query || !query.trim()) {
    return {
      query,
      results: [],
      totalCandidates: candidates.length,
      tokensUsed: 0,
      confidence: 'low',
      latencyMs: 0,
    };
  }

  // 截断候选池
  let workingCandidates = candidates;
  if (candidates.length > MAX_CANDIDATES) {
    workingCandidates = candidates.slice(0, MAX_CANDIDATES);
  }

  if (workingCandidates.length === 0) {
    return {
      query,
      results: [],
      totalCandidates: 0,
      tokensUsed: 0,
      confidence: 'low',
      latencyMs: 0,
    };
  }

  // 如果有 1 个候选，直接返回（无需调用 API）
  if (workingCandidates.length === 1) {
    const result: SicrRankedResult = {
      id: workingCandidates[0].id,
      text: workingCandidates[0].text,
      score: 0.5, // 默认中等
      metadata: workingCandidates[0].metadata,
    };
    return {
      query,
      results: [result],
      totalCandidates: 1,
      tokensUsed: 0,
      confidence: 'medium',
      latencyMs: Date.now() - startTime,
    };
  }

  // 构建候选文本
  const candidateLines = workingCandidates.map((c, i) =>
    `[${i + 1}] id: ${c.id}\n    text: ${c.text.slice(0, 500)}`,
  );
  const candidateBlock = candidateLines.join('\n\n');

  // 构建 user message
  const userMessage = `Query: ${query}\n\nCandidates:\n${candidateBlock}\n\nRank the candidates by relevance to the query. Output only the ranking block.`;

  // 获取 API 配置
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

  if (!apiKey) {
    console.warn('[sicr] DEEPSEEK_API_KEY not configured, falling back to identity');
    // 降级：返回原始顺序（加默认分数）
    return {
      query,
      results: workingCandidates.slice(0, topK).map((c) => ({
        id: c.id,
        text: c.text,
        score: 0.5,
        metadata: c.metadata,
      })),
      totalCandidates: workingCandidates.length,
      tokensUsed: 0,
      confidence: 'low',
      latencyMs: Date.now() - startTime,
    };
  }

  // ════════════════════════════════════════════════════
  // 调用 DeepSeek V4-Flash
  // ════════════════════════════════════════════════════

  try {
    const requestBody: Record<string, unknown> = {
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: SICR_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,  // 低温度确保一致性
      // V4-Flash 始终输出 thinking，需预留充足 token 给输出
      max_tokens: Math.min(1000 + topK * 50, 3000),
    };

    // 可选：启用 reasoning（思考模式）
    if (options?.includeReasoning) {
      requestBody.reasoning_effort = 'high';
    }

    const apiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`[sicr] DeepSeek API error: ${apiResponse.status} ${errorText}`);
      // 降级
      return {
        query,
        results: workingCandidates.slice(0, topK).map((c) => ({
          id: c.id,
          text: c.text,
          score: 0.5,
          metadata: c.metadata,
        })),
        totalCandidates: workingCandidates.length,
        tokensUsed: 0,
        confidence: 'low',
        latencyMs: Date.now() - startTime,
      };
    }

    const data = (await apiResponse.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          reasoning_content?: string;
        };
        finish_reason: string;
      }>;
      usage?: {
        total_tokens?: number;
      };
    };

    const content = data.choices[0]?.message?.content || '';
    const reasoning = data.choices[0]?.message?.reasoning_content || '';
    const tokensUsed = data.usage?.total_tokens ?? 0;

    // ════════════════════════════════════════════════════
    // 解析排名结果
    // ════════════════════════════════════════════════════

    const rankedResults = parseRankingResult(content, workingCandidates, minScore);

    // 计算置信度指标
    const scores = rankedResults.map((r) => r.score);
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const minScoreActual = scores.length > 0 ? Math.min(...scores) : 0;
    const meanScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const scoreSpread = maxScore - minScoreActual;

    let confidence: 'high' | 'medium' | 'low';
    const anomalyFlags: string[] = [];

    if (maxScore >= CONFIDENCE_THRESHOLDS.HIGH_MIN && scoreSpread >= CONFIDENCE_THRESHOLDS.SPREAD_MIN) {
      confidence = 'high';
    } else if (maxScore >= CONFIDENCE_THRESHOLDS.MEDIUM_MIN) {
      confidence = 'medium';
      if (scoreSpread < CONFIDENCE_THRESHOLDS.SPREAD_MIN) {
        anomalyFlags.push('narrow_score_spread');
      }
    } else {
      confidence = 'low';
      if (maxScore < 0.3) {
        anomalyFlags.push('all_scores_low');
      }
      if (rankedResults.length === 0) {
        anomalyFlags.push('no_results_above_min');
      }
    }

    // ════════════════════════════════════════════════════
    // 日志记录
    // ════════════════════════════════════════════════════

    const logEvent: SicrLogEvent = {
      timestamp: new Date().toISOString(),
      query: query.slice(0, 200),
      candidateCount: workingCandidates.length,
      topK,
      maxScore,
      minScore: minScoreActual,
      meanScore,
      confidence,
      anomalyFlags,
    };

    logSicrEvent(logEvent);

    // 低置信度时 console 警告
    if (confidence === 'low') {
      console.warn(`[sicr] Low confidence: query="${query.slice(0, 60)}" maxScore=${maxScore.toFixed(3)} flags=${anomalyFlags.join(',')}`);
    }

    const latencyMs = Date.now() - startTime;

    return {
      query,
      results: rankedResults.slice(0, topK),
      totalCandidates: workingCandidates.length,
      tokensUsed,
      confidence,
      latencyMs,
      reasoning: options?.includeReasoning ? reasoning : undefined,
    };
  } catch (err) {
    const error = err as Error;
    console.error(`[sicr] API call failed: ${error.message}`);
    // 降级：返回原始顺序
    return {
      query,
      results: workingCandidates.slice(0, topK).map((c) => ({
        id: c.id,
        text: c.text,
        score: 0.5,
        metadata: c.metadata,
      })),
      totalCandidates: workingCandidates.length,
      tokensUsed: 0,
      confidence: 'low',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// 解析函数
// ══════════════════════════════════════════════════════════════════

/**
 * 从 LLM 输出中解析排名结果。
 * 支持 [RANKING]...[/RANKING] 格式。
 */
function parseRankingResult(
  content: string,
  candidates: SicrCandidate[],
  minScore: number,
): SicrRankedResult[] {
  // 建立 id → SicrCandidate 的快速查找
  const candidateMap = new Map<string, SicrCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.id, c);
  }

  // 提取 [RANKING] 块
  const rankingMatch = content.match(/\[RANKING\]([\s\S]*?)\[\/RANKING\]/);
  if (!rankingMatch) {
    // 如果没有标记块，尝试直接解析每行
    // 支持格式: "1. id: xxx, score: 0.xx"
    return parseRankingLines(content, candidateMap, minScore);
  }

  return parseRankingLines(rankingMatch[1], candidateMap, minScore);
}

/**
 * 从文本行中解析排名结果。
 * 格式: "1. id: <id>, score: <0.0-1.0>"
 * 或   "1. id:<id>, score:<0.0-1.0>"
 */
function parseRankingLines(
  text: string,
  candidateMap: Map<string, SicrCandidate>,
  minScore: number,
): SicrRankedResult[] {
  const results: SicrRankedResult[] = [];
  const lines = text.split('\n');

  const pattern = /id:\s*(\S+)\s*,\s*score:\s*([0-9.]+)/i;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;

    const id = match[1].trim();
    const rawScore = parseFloat(match[2]);
    const score = Math.max(0, Math.min(1, isNaN(rawScore) ? 0 : rawScore));

    if (score < minScore) continue;

    const candidate = candidateMap.get(id);
    if (!candidate) continue;

    results.push({
      id,
      text: candidate.text,
      score,
      metadata: candidate.metadata,
    });
  }

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ══════════════════════════════════════════════════════════════════
// 日志层（low-confidence 三件套之一）
// ══════════════════════════════════════════════════════════════════

/**
 * 记录 SICR 调用事件到日志文件。
 * 日志按日期分割，JSON Lines 格式。
 */
function logSicrEvent(event: SicrLogEvent): void {
  try {
    // 确保日志目录存在
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `sicr-${today}.jsonl`);

    fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf-8');
  } catch {
    // 日志失败不中断主流程
  }
}

/**
 * 获取最近的 SICR 日志统计。
 */
function getRecentStats(): {
  totalCalls: number;
  lowConfidenceCount: number;
  flagCounts: Record<string, number>;
} {
  const stats = {
    totalCalls: 0,
    lowConfidenceCount: 0,
    flagCounts: {} as Record<string, number>,
  };

  try {
    if (!fs.existsSync(LOG_DIR)) return stats;

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `sicr-${today}.jsonl`);

    if (!fs.existsSync(logFile)) return stats;

    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as SicrLogEvent;
        stats.totalCalls++;
        if (event.confidence === 'low') stats.lowConfidenceCount++;
        for (const flag of event.anomalyFlags) {
          stats.flagCounts[flag] = (stats.flagCounts[flag] || 0) + 1;
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* silent */ }

  return stats;
}

// ══════════════════════════════════════════════════════════════════
// Express 路由器
// ══════════════════════════════════════════════════════════════════

/**
 * 创建 SICR Express 路由器。
 */
export function createSicrRouter(): Router {
  const router = Router();

  // ════════════════════════════════════════════════
  // POST /api/sicr/search — 通用语义搜索
  // ════════════════════════════════════════════════

  router.post('/api/sicr/search', async (req: Request, res: Response) => {
    try {
      const { query, candidates, topK, minScore, includeReasoning } = req.body as {
        query?: string;
        candidates?: SicrCandidate[];
        topK?: number;
        minScore?: number;
        includeReasoning?: boolean;
      };

      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'query (string) is required' });
        return;
      }

      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.status(400).json({ error: 'candidates (non-empty array) is required' });
        return;
      }

      // 验证候选格式
      for (const c of candidates) {
        if (!c.id || typeof c.id !== 'string') {
          res.status(400).json({ error: 'Each candidate must have a string id' });
          return;
        }
        if (!c.text || typeof c.text !== 'string') {
          res.status(400).json({ error: 'Each candidate must have a string text' });
          return;
        }
      }

      const result = await rankCandidates(query, candidates, {
        topK: Math.min(topK ?? DEFAULT_TOP_K, 50),
        minScore: minScore ?? DEFAULT_MIN_SCORE,
        includeReasoning: includeReasoning === true,
      });

      res.json(result);
    } catch (err) {
      const error = err as Error;
      console.error(`[sicr] Search error: ${error.message}`);
      res.status(500).json({ error: 'SICR search failed', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // GET /api/sicr/stats — 调用统计
  // ════════════════════════════════════════════════

  router.get('/api/sicr/stats', (_req: Request, res: Response) => {
    const stats = getRecentStats();
    res.json({
      ...stats,
      thresholds: CONFIDENCE_THRESHOLDS,
      maxCandidates: MAX_CANDIDATES,
    });
  });

  return router;
}
