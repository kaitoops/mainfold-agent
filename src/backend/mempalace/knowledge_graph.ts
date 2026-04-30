/**
 * knowledge_graph.ts — SQLite-backed Temporal Entity-Relationship Graph
 *
 * Logic extracted from nous_reference/knowledge_graph.py
 * Storage: better-sqlite3 (already in package.json)
 *
 * Features:
 *   - Entity nodes (people, projects, tools, concepts)
 *   - Typed relationship edges (child_of, does, loves, works_on, etc.)
 *   - Temporal validity (valid_from → valid_to)
 *   - Closet references (links back to verbatim memory)
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as crypto from 'crypto';

// ── Types ──

export interface EntityData {
  id: string;
  name: string;
  type: string;
  properties: Record<string, any>;
  createdAt: string;
}

export interface TripleData {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  sourceCloset: string | null;
  sourceFile: string | null;
  extractedAt: string;
}

export interface TripleQueryResult {
  direction: 'outgoing' | 'incoming';
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  sourceCloset: string | null;
  current: boolean;
}

export interface TripleWithNames {
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  current: boolean;
}

export interface KnowledgeGraphStats {
  entities: number;
  triples: number;
  currentFacts: number;
  expiredFacts: number;
  relationshipTypes: string[];
}

// ── Knowledge Graph ──

export class KnowledgeGraph {
  private db: DatabaseType;

  /**
   * @param dbPath Path to SQLite file. Defaults to ':memory:'.
   *               Use a file path for persistent storage.
   */
  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ── Schema ──

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS triples (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_closet TEXT,
        source_file TEXT,
        extracted_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (subject) REFERENCES entities(id),
        FOREIGN KEY (object) REFERENCES entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
      CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
      CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
    `);
  }

  // ── Helpers ──

  private entityId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/'/g, '');
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Entity Operations ──

  /**
   * Add or update an entity node.
   */
  addEntity(name: string, entityType: string = 'unknown', properties: Record<string, any> = {}): string {
    const eid = this.entityId(name);
    const props = JSON.stringify(properties);

    this.db.prepare(
      'INSERT OR REPLACE INTO entities (id, name, type, properties) VALUES (?, ?, ?, ?)'
    ).run(eid, name, entityType, props);

    return eid;
  }

  /**
   * Get entity by ID or name.
   */
  getEntity(nameOrId: string): EntityData | null {
    const id = this.entityId(nameOrId);
    const row = this.db.prepare(
      'SELECT id, name, type, properties, created_at FROM entities WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      properties: JSON.parse(row.properties || '{}'),
      createdAt: row.created_at,
    };
  }

  /**
   * Find entities by type.
   */
  findEntitiesByType(entityType: string): EntityData[] {
    const rows = this.db.prepare(
      'SELECT id, name, type, properties, created_at FROM entities WHERE type = ?'
    ).all(entityType) as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      properties: JSON.parse(r.properties || '{}'),
      createdAt: r.created_at,
    }));
  }

  /**
   * Search entities by name substring.
   */
  searchEntities(query: string): EntityData[] {
    const rows = this.db.prepare(
      'SELECT id, name, type, properties, created_at FROM entities WHERE name LIKE ?'
    ).all(`%${query}%`) as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      properties: JSON.parse(r.properties || '{}'),
      createdAt: r.created_at,
    }));
  }

  /**
   * Get all entities of a specific type.
   */
  getEntitiesByType(entityType: string): EntityData[] {
    const rows = this.db.prepare(
      'SELECT id, name, type, properties, created_at FROM entities WHERE type = ?'
    ).all(entityType) as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      properties: JSON.parse(r.properties || '{}'),
      createdAt: r.created_at,
    }));
  }

  // ── Triple Operations ──

  /**
   * Add a relationship triple: subject → predicate → object.
   *
   * Automatically creates entities if they don't exist.
   * Returns the triple ID (or existing ID if duplicate).
   */
  addTriple(
    subject: string,
    predicate: string,
    obj: string,
    options: {
      validFrom?: string;
      validTo?: string;
      confidence?: number;
      sourceCloset?: string;
      sourceFile?: string;
    } = {},
  ): string {
    const subId = this.entityId(subject);
    const objId = this.entityId(obj);
    const pred = predicate.toLowerCase().replace(/\s+/g, '_');

    // Auto-create entities if they don't exist
    this.db.prepare('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)').run(subId, subject);
    this.db.prepare('INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)').run(objId, obj);

    // Check for existing identical triple that's still valid
    const existing = this.db.prepare(
      'SELECT id FROM triples WHERE subject=? AND predicate=? AND object=? AND valid_to IS NULL'
    ).get(subId, pred, objId) as any;

    if (existing) return existing.id;

    const tripleId = `t_${subId}_${pred}_${objId}_${crypto.randomBytes(4).toString('hex')}`;

    this.db.prepare(`
      INSERT INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_closet, source_file)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tripleId,
      subId,
      pred,
      objId,
      options.validFrom ?? null,
      options.validTo ?? null,
      options.confidence ?? 1.0,
      options.sourceCloset ?? null,
      options.sourceFile ?? null,
    );

    return tripleId;
  }

  /**
   * Mark a relationship as no longer valid (set valid_to).
   */
  invalidate(subject: string, predicate: string, obj: string, ended?: string): void {
    const subId = this.entityId(subject);
    const objId = this.entityId(obj);
    const pred = predicate.toLowerCase().replace(/\s+/g, '_');
    const endDate = ended ?? new Date().toISOString().split('T')[0];

    this.db.prepare(
      "UPDATE triples SET valid_to=? WHERE subject=? AND predicate=? AND object=? AND valid_to IS NULL"
    ).run(endDate, subId, pred, objId);
  }

  // ── Query Operations ──

  /**
   * Get all relationships for an entity.
   *
   * @param name Entity name
   * @param asOf Optional date string — only return facts valid at that time
   * @param direction 'outgoing' | 'incoming' | 'both'
   */
  queryEntity(
    name: string,
    asOf?: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'outgoing',
  ): TripleQueryResult[] {
    const eid = this.entityId(name);
    const results: TripleQueryResult[] = [];

    if (direction === 'outgoing' || direction === 'both') {
      let query = `
        SELECT t.*, e.name as obj_name
        FROM triples t
        JOIN entities e ON t.object = e.id
        WHERE t.subject = ?
      `;
      const params: any[] = [eid];

      if (asOf) {
        query += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)';
        params.push(asOf, asOf);
      }

      const rows = this.db.prepare(query).all(...params) as any[];
      for (const row of rows) {
        results.push({
          direction: 'outgoing',
          subject: name,
          predicate: row.predicate,
          object: row.obj_name,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          confidence: row.confidence,
          sourceCloset: row.source_closet,
          current: row.valid_to === null,
        });
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      let query = `
        SELECT t.*, e.name as sub_name
        FROM triples t
        JOIN entities e ON t.subject = e.id
        WHERE t.object = ?
      `;
      const params: any[] = [eid];

      if (asOf) {
        query += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)';
        params.push(asOf, asOf);
      }

      const rows = this.db.prepare(query).all(...params) as any[];
      for (const row of rows) {
        results.push({
          direction: 'incoming',
          subject: row.sub_name,
          predicate: row.predicate,
          object: name,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          confidence: row.confidence,
          sourceCloset: row.source_closet,
          current: row.valid_to === null,
        });
      }
    }

    return results;
  }

  /**
   * Get all triples with a given relationship type.
   */
  queryRelationship(predicate: string, asOf?: string): TripleWithNames[] {
    const pred = predicate.toLowerCase().replace(/\s+/g, '_');
    let query = `
      SELECT t.*, s.name as sub_name, o.name as obj_name
      FROM triples t
      JOIN entities s ON t.subject = s.id
      JOIN entities o ON t.object = o.id
      WHERE t.predicate = ?
    `;
    const params: any[] = [pred];

    if (asOf) {
      query += ' AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)';
      params.push(asOf, asOf);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      subject: r.sub_name,
      predicate: pred,
      object: r.obj_name,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      confidence: r.confidence,
      current: r.valid_to === null,
    }));
  }

  /**
   * Get all facts in chronological order, optionally filtered by entity.
   */
  timeline(entityName?: string): TripleWithNames[] {
    let query: string;
    let params: any[];

    if (entityName) {
      const eid = this.entityId(entityName);
      query = `
        SELECT t.*, s.name as sub_name, o.name as obj_name
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        WHERE (t.subject = ? OR t.object = ?)
        ORDER BY t.valid_from ASC NULLS LAST
        LIMIT 100
      `;
      params = [eid, eid];
    } else {
      query = `
        SELECT t.*, s.name as sub_name, o.name as obj_name
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        ORDER BY t.valid_from ASC NULLS LAST
        LIMIT 100
      `;
      params = [];
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      subject: r.sub_name,
      predicate: r.predicate,
      object: r.obj_name,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      confidence: r.confidence,
      current: r.valid_to === null,
    }));
  }

  // ── Stats ──

  stats(): KnowledgeGraphStats {
    const entities = (this.db.prepare('SELECT COUNT(*) as n FROM entities').get() as any).n;
    const triples = (this.db.prepare('SELECT COUNT(*) as n FROM triples').get() as any).n;
    const current = (this.db.prepare('SELECT COUNT(*) as n FROM triples WHERE valid_to IS NULL').get() as any).n;
    const predicates = this.db.prepare('SELECT DISTINCT predicate FROM triples ORDER BY predicate').all() as any[];

    return {
      entities,
      triples,
      currentFacts: current,
      expiredFacts: triples - current,
      relationshipTypes: predicates.map(r => r.predicate),
    };
  }

  // ── Seed ──

  /**
   * Seed the knowledge graph from entity facts map.
   * Format: { key: { full_name, type, parent, partner, interests, ... } }
   */
  seedFromEntityFacts(entityFacts: Record<string, Record<string, any>>): void {
    for (const [key, facts] of Object.entries(entityFacts)) {
      const name = facts.full_name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const etype = facts.type ?? 'person';

      this.addEntity(name, etype, {
        gender: facts.gender ?? '',
        birthday: facts.birthday ?? '',
      });

      // Parent relationship
      if (facts.parent) {
        this.addTriple(name, 'child_of', facts.parent.charAt(0).toUpperCase() + facts.parent.slice(1), {
          validFrom: facts.birthday || undefined,
        });
      }

      // Partner relationship
      if (facts.partner) {
        this.addTriple(name, 'married_to', facts.partner.charAt(0).toUpperCase() + facts.partner.slice(1));
      }

      // Relationship type
      const rel = facts.relationship ?? '';
      if (rel === 'daughter' && facts.parent) {
        this.addTriple(
          name,
          'is_child_of',
          facts.parent.charAt(0).toUpperCase() + facts.parent.slice(1),
          { validFrom: facts.birthday || undefined },
        );
      } else if (rel === 'husband' && facts.partner) {
        this.addTriple(name, 'is_partner_of', facts.partner.charAt(0).toUpperCase() + facts.partner.slice(1));
      } else if (rel === 'brother' && facts.sibling) {
        this.addTriple(name, 'is_sibling_of', facts.sibling.charAt(0).toUpperCase() + facts.sibling.slice(1));
      } else if (rel === 'dog' && facts.owner) {
        this.addTriple(name, 'is_pet_of', facts.owner.charAt(0).toUpperCase() + facts.owner.slice(1));
        this.addEntity(name, 'animal');
      }

      // Interests
      for (const interest of (facts.interests ?? [])) {
        this.addTriple(name, 'loves', interest.charAt(0).toUpperCase() + interest.slice(1), {
          validFrom: '2025-01-01',
        });
      }
    }
  }
}
