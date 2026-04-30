/**
 * mempalace/index.ts — Unified entry point for MemPalace Core
 *
 * Exports all MemPalace modules for use by the Backend.
 *
 * Architecture:
 *   normalize.ts       — Pure text processing (no dependencies)
 *   knowledge_graph.ts — SQLite graph storage (depends on better-sqlite3)
 *   entity_registry.ts — Entity detection + registry (standalone)
 *   searcher.ts        — KG search + traversal (depends on knowledge_graph)
 *   pathfinder.ts      — System stuck detection (depends on TRI types)
 */

export {
  normalize,
  chunkExchanges,
  detectConvoRoom,
} from './normalize.js';
export type { Chunk } from './normalize.js';

export { KnowledgeGraph } from './knowledge_graph.js';
export type {
  EntityData,
  TripleData,
  TripleQueryResult,
  TripleWithNames,
  KnowledgeGraphStats,
} from './knowledge_graph.js';

export { EntityRegistry, extractCandidates, scoreEntity, classifyEntity } from './entity_registry.js';
export type {
  PersonInfo,
  LookupResult,
  EntityCandidate,
  EntitySignals,
} from './entity_registry.js';

export { MemorySearcher } from './searcher.js';
export type {
  SearchResult,
  GraphPath,
  Tunnel,
} from './searcher.js';

export { detectStuck, createPathSession, generateCandidates } from './pathfinder.js';
export type { PathSession, PathfindCandidate, CandidateResult } from './pathfinder.js';
