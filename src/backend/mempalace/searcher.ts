/**
 * searcher.ts — Search and graph traversal for MemPalace Knowledge Graph.
 *
 * Merges logic from:
 *   - nous_reference/searcher.py — search (without ChromaDB)
 *   - nous_reference/palace_graph.py — graph traversal, tunnels
 *
 * Implements:
 *   - Entity search (text match against KG)
 *   - Graph traversal (find paths through shared entity relationships)
 *   - Tunnel detection (entities connecting multiple "wings")
 */

import { KnowledgeGraph, EntityData } from './knowledge_graph.js';

// ── Types ──

export interface SearchResult {
  entity: EntityData;
  score: number;
  matchField: 'name' | 'type' | 'property';
  matchedText: string;
}

export interface GraphPath {
  entity: string;
  type: string;
  connectedVia: string[];
  hop: number;
  count: number;
}

export interface Tunnel {
  entityName: string;
  entityId: string;
  entityType: string;
  wings: string[];
  count: number;
}

export interface SearcherOptions {
  /** Maximum results for search queries */
  maxResults?: number;
}

// ── Searched ──

export class MemorySearcher {
  private kg: KnowledgeGraph;
  private maxResults: number;

  constructor(kg: KnowledgeGraph, options: SearcherOptions = {}) {
    this.kg = kg;
    this.maxResults = options.maxResults ?? 20;
  }

  /**
   * Search entities by name, type, or property match.
   */
  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Search entities by name (fuzzy substring match)
    const entities = this.kg.searchEntities(query);
    for (const entity of entities) {
      const score = this.calculateScore(queryLower, entity.name.toLowerCase());
      results.push({ entity, score, matchField: 'name', matchedText: entity.name });
    }

    // Sort by score descending, limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, this.maxResults);
  }

  /**
   * Search entities by exact type.
   */
  searchByType(entityType: string): EntityData[] {
    return this.kg.findEntitiesByType(entityType);
  }

  // ── Graph Traversal ──

  /**
   * Traverse the knowledge graph from a starting entity.
   * Finds entities connected via shared relationships.
   */
  traverseGraph(startEntity: string, maxHops: number = 2): GraphPath[] {
    const results: GraphPath[] = [];
    const visited = new Set<string>();

    // Build a simple in-memory "which entities share relationships" map
    // We traverse by: entity A → triple → entity B → triple → entity C
    const outgoing = this.kg.queryEntity(startEntity, undefined, 'outgoing');
    const incoming = this.kg.queryEntity(startEntity, undefined, 'incoming');

    // Collect directly connected entities (hop 1)
    const connectedTypes: Record<string, Set<string>> = {}; // entityName → set of relationship types

    for (const rel of outgoing) {
      if (!connectedTypes[rel.object]) connectedTypes[rel.object] = new Set();
      connectedTypes[rel.object].add(rel.predicate);
    }
    for (const rel of incoming) {
      if (!connectedTypes[rel.subject]) connectedTypes[rel.subject] = new Set();
      connectedTypes[rel.subject].add(rel.predicate);
    }

    visited.add(startEntity.toLowerCase());

    // Hop 1
    for (const [entityName, types] of Object.entries(connectedTypes)) {
      if (visited.has(entityName.toLowerCase())) continue;
      visited.add(entityName.toLowerCase());

      const entity = this.kg.getEntity(entityName);
      results.push({
        entity: entityName,
        type: entity?.type ?? 'unknown',
        connectedVia: [...types],
        hop: 1,
        count: types.size,
      });

      // Hop 2: entities connected to hop-1 entities
      if (maxHops >= 2) {
        const hop2Out = this.kg.queryEntity(entityName, undefined, 'outgoing');
        const hop2In = this.kg.queryEntity(entityName, undefined, 'incoming');

        for (const rel2 of [...hop2Out, ...hop2In]) {
          const hop2Name = rel2.direction === 'outgoing' ? rel2.object : rel2.subject;
          if (visited.has(hop2Name.toLowerCase())) continue;
          visited.add(hop2Name.toLowerCase());

          const entity2 = this.kg.getEntity(hop2Name);
          results.push({
            entity: hop2Name,
            type: entity2?.type ?? 'unknown',
            connectedVia: [rel2.predicate],
            hop: 2,
            count: 1,
          });
        }
      }
    }

    return results.sort((a, b) => a.hop - b.hop || b.count - a.count).slice(0, 50);
  }

  /**
   * Find entities that connect multiple "wings".
   * Wings are entity types (person, project, tool, concept).
   * Tunnels are entities that have relationships across different types.
   */
  findTunnels(): Tunnel[] {
    const stats = this.kg.stats();
    const tunnels: Tunnel[] = [];

    // For each entity type, find entities that have relationships
    // with entities of other types
    for (const entityType of stats.relationshipTypes) {
      // Get all triples for this predicate
      const triples = this.kg.queryRelationship(entityType);

      // Find entities that bridge types
      const bridgingEntities = new Map<string, Set<string>>();

      for (const triple of triples) {
        const subEntity = this.kg.getEntity(triple.subject);
        const objEntity = this.kg.getEntity(triple.object);

        if (subEntity && objEntity && subEntity.type !== objEntity.type) {
          // The subject bridges to the object's type
          const key = `${subEntity.name}::${subEntity.type}`;
          if (!bridgingEntities.has(key)) bridgingEntities.set(key, new Set());
          bridgingEntities.get(key)!.add(objEntity.type);
        }
      }

      for (const [key, wings] of bridgingEntities) {
        const [entityName, entityType] = key.split('::');
        if (wings.size >= 1) {
          tunnels.push({
            entityName,
            entityId: this.kg.getEntity(entityName)?.id ?? entityName.toLowerCase(),
            entityType,
            wings: [...wings],
            count: wings.size,
          });
        }
      }
    }

    // Deduplicate and sort
    const seen = new Set<string>();
    const unique = tunnels.filter(t => {
      const key = `${t.entityId}:${[...t.wings].sort().join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.sort((a, b) => b.count - a.count).slice(0, 50);
  }

  // ── Graph Stats ──

  /**
   * Summary statistics about the knowledge graph structure.
   */
  graphStats(): object {
    return this.kg.stats();
  }

  // ── Private ──

  /**
   * Simple fuzzy match score between query and name.
   */
  private calculateScore(queryLower: string, nameLower: string): number {
    if (nameLower === queryLower) return 1.0;
    if (nameLower.startsWith(queryLower)) return 0.9;
    if (nameLower.includes(queryLower)) return 0.7;

    // Token match
    const queryTokens = queryLower.split(/\s+/);
    const nameTokens = nameLower.split(/\s+/);
    const matchedTokens = queryTokens.filter(qt =>
      nameTokens.some(nt => nt.includes(qt) || qt.includes(nt)),
    ).length;

    if (matchedTokens > 0) {
      return 0.3 + (matchedTokens / queryTokens.length) * 0.4;
    }

    return 0.0;
  }
}
