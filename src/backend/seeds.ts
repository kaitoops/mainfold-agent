/**
 * mainfold-agent — 心流种子模块（Lightweight Seed Pool）
 *
 * 种子直接存储在 KnowledgeGraph 中（entityType='flow_seed'），
 * 不需要修改实体检测器。
 */

export interface FlowSeed {
  id: string;
  content: string;
  status: 'DORMANT' | 'SPROUTED' | 'ARCHIVED';
  createdAt: string;
  currentContextId?: string;
  semanticAnchors?: string[];
}

export function createSeed(
  addFn: (name: string, entityType: string, properties: Record<string, any>) => string,
  content: string,
  contextId?: string,
  anchors?: string[],
): { id: string; seed: FlowSeed } {
  const now = new Date().toISOString();
  const seed: FlowSeed = {
    id: `seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    status: 'DORMANT',
    createdAt: now,
    currentContextId: contextId,
    semanticAnchors: anchors,
  };

  addFn(seed.id, 'flow_seed', {
    content: seed.content,
    status: seed.status,
    createdAt: seed.createdAt,
    contextId: contextId ?? '',
    anchors: JSON.stringify(anchors ?? []),
  });

  return { id: seed.id, seed };
}

export function listSeeds(
  getByTypeFn: (entityType: string) => any[],
  status?: 'DORMANT' | 'SPROUTED' | 'ARCHIVED',
): FlowSeed[] {
  const all = getByTypeFn('flow_seed') as any[];
  if (status) {
    const filtered = all.filter((e: any) => {
      const props = typeof e.properties === 'string' ? JSON.parse(e.properties) : e.properties;
      return props.status === status;
    });
    return filtered.map(serialize);
  }
  return all.map(serialize);
}

function serialize(raw: any): FlowSeed {
  const props = typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties;
  return {
    id: raw.name ?? raw.id ?? '',
    content: props.content ?? '',
    status: props.status ?? 'DORMANT',
    createdAt: props.createdAt ?? '',
    currentContextId: props.contextId ?? undefined,
    semanticAnchors: props.anchors ? JSON.parse(props.anchors) : undefined,
  };
}

export function getSeedsAsContext(getByTypeFn: (entityType: string) => any[]): string {
  const dormant = listSeeds(getByTypeFn, 'DORMANT');
  const sprouted = listSeeds(getByTypeFn, 'SPROUTED');
  if (dormant.length === 0 && sprouted.length === 0) return '';

  const lines: string[] = ['--- 心流种子 ---'];
  if (sprouted.length > 0) {
    lines.push('已发芽种子（建议在回答中引用）：');
    sprouted.forEach(s => {
      lines.push(`  [${s.id}] ${s.content.slice(0, 80)}`);
      if (s.semanticAnchors?.length) lines.push(`   锚点: ${s.semanticAnchors.join(', ')}`);
    });
  }
  if (dormant.length > 0) {
    lines.push('休眠种子：');
    dormant.slice(0, 5).forEach(s => {
      lines.push(`  [${s.id}] ${s.content.slice(0, 60)}`);
    });
    if (dormant.length > 5) lines.push(`  ...还有 ${dormant.length - 5} 颗休眠种子`);
  }
  return lines.join('\n');
}
