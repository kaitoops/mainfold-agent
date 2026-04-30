/**
 * pathfinder.ts — System stuck detection and path navigation.
 *
 * Design based on nous_reference/pathfinder.py (spec doc)
 * Bridges with TRI-State: when system enters DEGRADED/OVERLOAD/Critical,
 * pathfinder generates navigation candidates to break the cycle.
 *
 * Architecture note:
 *   The original WORKBUZZDY PATHFIND is a "absurd → ordered" human intervention
 *   mechanism. In mainfold-agent context, this becomes a "stuck → candidate →
 *   intervention" loop triggered by TRI state detection.
 */

import type { TriDimensions } from '../tri-state.js';

// ── Types ──

export type CandidateResult = 'A' | 'B' | 'C' | 'exited';

export interface PathSession {
  sessionId: string;
  anchor: string;
  anchorHash: string;
  candidates: string[];
  createdAt: string;
  selected: CandidateResult | null;
  condensed: boolean;
  condensedHash: string | null;
}

export interface PathfindCandidate {
  label: CandidateResult;
  description: string;
  action: string;
}

// ── Stuck detection thresholds ──

const STUCK_THRESHOLDS = {
  /** TRI score below this indicates possible stuck state */
  triScoreMin: 0.05,
  /** H below degraded threshold */
  H: 0.6,
  /** S below this for consecutive checks */
  S_consecutive: 0.2,
  /** Max probes allowed before forcing exit */
  maxProbes: 5,
};

// ── Predefined navigation candidates ──

function generateCandidates(tri: TriDimensions): PathfindCandidate[] {
  const candidates: PathfindCandidate[] = [];

  // A — Boost engagement (when idle)
  if (tri.A < 0.3) {
    candidates.push({
      label: 'A',
      description: '系统活跃度过低，建议发起新对话主题',
      action: 'reset_activity',
    });
  } else {
    candidates.push({
      label: 'A',
      description: '调整对话策略，优化命中率',
      action: 'optimize_success',
    });
  }

  // B — Reset health (when degraded)
  if (tri.H < 0.5) {
    candidates.push({
      label: 'B',
      description: '健康度不足，建议执行恢复协议',
      action: 'recovery_protocol',
    });
  } else if (tri.S < 0.3) {
    candidates.push({
      label: 'B',
      description: '命中率下降，建议回顾成功案例',
      action: 'review_patterns',
    });
  } else {
    candidates.push({
      label: 'B',
      description: '探索新领域，扩大知识覆盖面',
      action: 'explore_new_domain',
    });
  }

  // C — System reset
  candidates.push({
    label: 'C',
    description: '执行系统重置，恢复基线状态',
    action: 'system_reset',
  });

  return candidates;
}

function generateSessionId(): string {
  return `path_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect if the system is in a "stuck" state based on TRI dimensions.
 */
export function detectStuck(tri: TriDimensions): boolean {
  const triScore = tri.A * tri.S * tri.H;
  return (
    triScore < STUCK_THRESHOLDS.triScoreMin ||
    tri.H < STUCK_THRESHOLDS.H ||
    tri.S < STUCK_THRESHOLDS.S_consecutive
  );
}

/**
 * Create a new pathfind session with generated candidates.
 */
export function createPathSession(tri: TriDimensions): PathSession {
  const anchor = `A=${tri.A.toFixed(2)}_S=${tri.S.toFixed(2)}_H=${tri.H.toFixed(2)}`;
  const anchorHash = Buffer.from(anchor).toString('hex').slice(0, 16);
  const candidates = generateCandidates(tri);

  return {
    sessionId: generateSessionId(),
    anchor,
    anchorHash,
    candidates: candidates.map(c => `[${c.label}] ${c.description}`),
    createdAt: new Date().toISOString(),
    selected: null,
    condensed: false,
    condensedHash: null,
  };
}

export { generateCandidates, STUCK_THRESHOLDS };
