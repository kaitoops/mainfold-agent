/**
 * mempalace-mcp — MCP Server for MemPalace Knowledge Graph
 *
 * Protocol: MCP stdio JSON-RPC
 * Tools:
 *   search_entities — Search entities by name
 *   query_entity — Get all triples for an entity
 *   query_relationship — Get triples by predicate type
 *   traverse_graph — BFS traversal from a starting entity
 *   find_tunnels — Find entities bridging multiple types
 *   mempalace_stats — KG statistics
 */

import * as path from 'path';
import * as url from 'url';
import { KnowledgeGraph } from './knowledge_graph.js';
import { MemorySearcher } from './searcher.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../../config');
const KG_DB_PATH = path.join(CONFIG_DIR, 'mempalace_kg.sqlite3');

const kg = new KnowledgeGraph(KG_DB_PATH);
const searcher = new MemorySearcher(kg);

// ── MCP Protocol ──

interface McpRequest {
  id: string | number;
  type?: string;
  method?: string;
  params?: Record<string, any>;
}

interface McpResponse {
  id: string | number;
  type: string;
  result?: any;
  error?: string;
}

const tools: Record<string, (params: Record<string, any>) => any> = {
  search_entities: (params) => {
    const query = params.query as string;
    if (!query) return { error: 'query required' };
    return { results: searcher.search(query) };
  },

  query_entity: (params) => {
    const name = params.name as string;
    const asOf = params.as_of as string | undefined;
    if (!name) return { error: 'name required' };
    const entity = kg.getEntity(name);
    const triples = kg.queryEntity(name, asOf, 'both');
    return { entity, triples, count: triples.length };
  },

  query_relationship: (params) => {
    const predicate = params.predicate as string;
    const asOf = params.as_of as string | undefined;
    if (!predicate) return { error: 'predicate required' };
    const results = kg.queryRelationship(predicate, asOf);
    return { predicate, results, count: results.length };
  },

  traverse_graph: (params) => {
    const entity = params.entity as string;
    const maxHops = (params.max_hops as number) ?? 2;
    if (!entity) return { error: 'entity required' };
    const paths = searcher.traverseGraph(entity, maxHops);
    return { start: entity, paths, count: paths.length };
  },

  find_tunnels: (_params) => {
    const tunnels = searcher.findTunnels();
    return { tunnels, count: tunnels.length };
  },

  mempalace_stats: (_params) => {
    return kg.stats();
  },

  add_entity: (params) => {
    const { name, type, properties } = params as any;
    if (!name) return { error: 'name required' };
    const id = kg.addEntity(name, type ?? 'unknown', properties ?? {});
    return { id, name };
  },

  add_triple: (params) => {
    const { subject, predicate, object, ...opts } = params as any;
    if (!subject || !predicate || !object) return { error: 'subject, predicate, object required' };
    const id = kg.addTriple(subject, predicate, object, opts);
    return { id, subject, predicate, object };
  },
};

// ── Stdio Transport ──

function sendResponse(res: McpResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function handleRequest(req: McpRequest): void {
  const method = req.method ?? req.type;
  const handler = tools[method ?? ''];

  if (!handler) {
    sendResponse({ id: req.id, type: 'error', error: `Unknown tool: ${method}` });
    return;
  }

  try {
    const result = handler(req.params ?? {});
    sendResponse({ id: req.id, type: 'result', result });
  } catch (err) {
    sendResponse({ id: req.id, type: 'error', error: (err as Error).message });
  }
}

// ── Listen on stdin ──

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed);
      handleRequest(req);
    } catch {
      sendResponse({ id: 'parse_error', type: 'error', error: 'Invalid JSON' });
    }
  }
});

process.stdin.on('end', () => {
  kg.close();
});

// ── Startup message ──

console.error(`[mempalace-mcp] Started: KG=${KG_DB_PATH}`);
console.error(`[mempalace-mcp] Tools: ${Object.keys(tools).join(', ')}`);
