/**
 * mainfold-agent — Tavily 搜索服务 (TypeScript)
 *
 * 纯 TypeScript 实现 Tavily Web Search API 调用
 * 移植自 WorkBuddy tavily_search.py
 */

import { z } from 'zod';

const TAVILY_URL = 'https://api.tavily.com/search';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
}

const TavilyRequestSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(10).default(5),
  includeAnswer: z.boolean().default(false),
  searchDepth: z.enum(['basic', 'advanced']).default('basic'),
});

export async function searchTavily(
  apiKey: string,
  options: { query: string; maxResults?: number; includeAnswer?: boolean; searchDepth?: 'basic' | 'advanced' }
): Promise<TavilyResponse> {
  const parsed = TavilyRequestSchema.parse(options);
  const payload = {
    api_key: apiKey,
    query: parsed.query,
    max_results: parsed.maxResults,
    search_depth: parsed.searchDepth,
    include_answer: parsed.includeAnswer,
    include_images: false,
    include_raw_content: false,
  };

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);
  }

  const body = await res.json() as any;
  return {
    query: parsed.query,
    answer: body.answer ?? undefined,
    results: (body.results ?? []).slice(0, parsed.maxResults).map(
      (r: { title?: string; url?: string; content?: string }) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? '',
      }),
    ),
  };
}
