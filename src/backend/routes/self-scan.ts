/**
 * mainfold-agent — 自代码自省模块
 *
 * 核心功能：mainfold-agent 可以扫描、分析并理解自己的源代码结构。
 * 将 src/backend/ 递归扫描，构建结构化代码索引，
 * 导出依赖图、模块用途、文件详情，并通过 REST API 暴露，
 * 同时注册为 Function Calling 工具供 chat 流程调用。
 *
 * 工作方式：
 *   1. 文件级扫描：遍历 src/backend/ 下的所有 .ts 文件
 *   2. import/export 解析：正则提取每个文件的依赖和被导出符号
 *   3. 用途推断：基于路径模式和导出符号推断模块功能
 *   4. 依赖图构建：谁引用了谁，形成完整依赖关系
 *   5. SICR 集成：提供 /api/self/query 用自然语言查询代码
 *
 * 可用端点：
 *   GET  /api/self/scan       — 完整扫描（或返回缓存）
 *   GET  /api/self/files      — 文件列表（含大小/行数/用途描述）
 *   GET  /api/self/file/:path — 单个文件详情（imports/exports）
 *   GET  /api/self/deps       — 依赖图 JSON
 *   POST /api/self/query      — SICR 自然语言查询代码
 *   GET  /api/self/stats      — 代码统计数据（总文件/行数/模块数）
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 单文件扫描结果 */
export interface ScannedFile {
  /** 相对于 src/backend/ 的路径 */
  relativePath: string;
  /** 绝对路径 */
  absolutePath: string;
  /** 文件大小（字节） */
  sizeBytes: number;
  /** 代码行数 */
  lineCount: number;
  /** 导入语句列表 */
  imports: string[];
  /** 导出符号列表 */
  exports: string[];
  /** 推断的模块用途描述 */
  purpose: string;
  /** 模块类型/层级（routes/ /mempalace/ /memory/ 等） */
  moduleType: string;
  /** 最后修改时间 */
  lastModified: string;
}

/** 依赖图边 */
export interface DepEdge {
  from: string;
  to: string;
}

/** 完整扫描结果 */
export interface ScanResult {
  scannedAt: string;
  backendRoot: string;
  totalFiles: number;
  totalLines: number;
  totalSizeBytes: number;
  files: ScannedFile[];
  depGraph: {
    nodes: string[];
    edges: DepEdge[];
  };
  moduleStats: Record<string, number>;
}

/** 自然语言查询请求 */
export interface SelfQueryRequest {
  query: string;
  topK?: number;
}

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');  // routes/ → backend/
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
const SCAN_CACHE_TTL_MS = 30_000; // 30 秒缓存有效期

// ══════════════════════════════════════════════════════════════════
// 缓存
// ══════════════════════════════════════════════════════════════════

let scanCache: { result: ScanResult; timestamp: number } | null = null;

// ══════════════════════════════════════════════════════════════════
// 核心扫描函数
// ══════════════════════════════════════════════════════════════════

/**
 * 递归扫描 src/backend/ 目录，构建完整代码索引。
 * 结果缓存 30 秒，避免高频重复扫描。
 */
export function scanBackend(): ScanResult {
  // 缓存检查
  if (scanCache && (Date.now() - scanCache.timestamp) < SCAN_CACHE_TTL_MS) {
    return scanCache.result;
  }

  const files: ScannedFile[] = [];
  const depEdges: DepEdge[] = [];
  const moduleStats: Record<string, number> = {};
  let totalLines = 0;
  let totalSizeBytes = 0;

  // 递归扫描
  function walkDir(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过 node_modules、dist、__pycache__ 等
        if (entry.name.startsWith('node_modules') || entry.name.startsWith('dist') || entry.name.startsWith('__')) {
          continue;
        }
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const fileScan = scanFile(fullPath);
        if (fileScan) {
          files.push(fileScan);
          totalLines += fileScan.lineCount;
          totalSizeBytes += fileScan.sizeBytes;

          // 累计模块类型统计
          moduleStats[fileScan.moduleType] = (moduleStats[fileScan.moduleType] || 0) + 1;

          // 构建依赖边
          for (const imp of fileScan.imports) {
            const resolved = resolveDep(fileScan.relativePath, imp);
            if (resolved) {
              depEdges.push({ from: fileScan.relativePath, to: resolved });
            }
          }
        }
      }
    }
  }

  walkDir(BACKEND_ROOT);

  // 去重节点
  const allNodes = [...new Set(files.map(f => f.relativePath))];

  const result: ScanResult = {
    scannedAt: new Date().toISOString(),
    backendRoot: BACKEND_ROOT,
    totalFiles: files.length,
    totalLines,
    totalSizeBytes,
    files,
    depGraph: { nodes: allNodes, edges: depEdges },
    moduleStats,
  };

  // 更新缓存
  scanCache = { result, timestamp: Date.now() };

  return result;
}

/**
 * 扫描单个 .ts 文件：提取 imports、exports、推断用途。
 */
function scanFile(absolutePath: string): ScannedFile | null {
  try {
    const relPath = path.relative(BACKEND_ROOT, absolutePath).replace(/\\/g, '/');
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');
    const lineCount = lines.length;
    const stat = fs.statSync(absolutePath);

    const imports: string[] = [];
    const exports: string[] = [];

    // Import 提取
    for (const line of lines) {
      // import { x } from 'y'
      // import x from 'y'
      // import * as x from 'y'
      const impMatch = line.match(/^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"](\..*?)['"]/);
      // 只提取相对导入（本地模块）
      if (impMatch) {
        imports.push(impMatch[1]);
      }
    }

    // Export 提取
    for (const line of lines) {
      // export function xxx
      const exportFuncMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
      if (exportFuncMatch) exports.push(exportFuncMatch[1]);

      // export class xxx
      const exportClassMatch = line.match(/^export\s+class\s+(\w+)/);
      if (exportClassMatch) exports.push(exportClassMatch[1]);

      // export interface xxx
      const exportInterfaceMatch = line.match(/^export\s+interface\s+(\w+)/);
      if (exportInterfaceMatch) exports.push(exportInterfaceMatch[1]);

      // export const xxx
      const exportConstMatch = line.match(/^export\s+(?:const|let|var)\s+(\w+)/);
      if (exportConstMatch) exports.push(exportConstMatch[1]);

      // export type xxx
      const exportTypeMatch = line.match(/^export\s+type\s+(\w+)/);
      if (exportTypeMatch) exports.push(exportTypeMatch[1]);
    }

    // 推断模块类型
    const moduleType = inferModuleType(relPath);

    // 推断用途
    const purpose = inferPurpose(relPath, exports);

    return {
      relativePath: relPath,
      absolutePath,
      sizeBytes: stat.size,
      lineCount,
      imports,
      exports,
      purpose,
      moduleType,
      lastModified: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * 推断模块类型（基于路径层级）。
 */
function inferModuleType(relPath: string): string {
  const parts = relPath.split('/');
  if (parts[0] === 'mempalace') return 'mempalace';
  if (parts[0] === 'memory') return 'memory';
  if (parts[0] === 'routes') return 'routes';
  if (parts[0] === 'middleware') return 'middleware';
  return 'core';
}

/**
 * 推断模块用途（基于路径+导出符号）。
 */
function inferPurpose(relPath: string, exports: string[]): string {
  const filename = path.basename(relPath, '.ts');
  const dir = path.dirname(relPath);

  // 特定文件名匹配
  const purposeMap: Record<string, string> = {
    'index': 'Express 应用入口，模块注册和启动序列',
    'chat': 'Chat 路由：对话处理管道 + Function Calling 循环',
    'soul-loader': 'SOUL.md 加载器：身份注入 + 威胁扫描 + 输出协议注入',
    'identity-assert': '身份断言：验证 Agent 知道自己的身份',
    'tri-state': 'TRI 状态协调器：A×S×H 三维状态机',
    'health-signal': '健康度监控：心跳检测 + 事件驱动状态管理',
    'seeds': '心流种子引擎：种子创建/管理/状态转换',
    'sicr-router': 'SICR 语义搜索层：Scaffolded In-Context Retrieval',
    'self-scan': '自代码自省模块：代码扫描/分析/依赖图',
    'esa-core': '具身自注意力认知架构：三层注意力/BPS/置信度',
    'knowledge_graph': 'SQLite 知识图谱：实体/关系/属性持久化',
    'tavily': 'Tavily 搜索路由：Web 搜索 API',
    'tools': '工具端点：exec/read-file/write-file/ls/git/http',
    'cold-db': '冷记忆层：SQLite 长期存储',
    'warm-index': '暖索引层：JSON 文件近期记忆',
    'memory-reviewer': '记忆整理器：冷热记忆自动同步',
    'inject': '注入路由：WebUI 消息注入',
    'models': '模型路由：模型列表和配置管理',
    'mempalace': 'MemPalace 核心：知识图谱浏览器和语义搜索',
    'security': '安全路由：EB-006 上下文守卫',
    'pathfinder': 'Pathfinder：卡死检测 + 路径发现',
    'memory': '记忆管理路由：冷/暖/整理器统一接口',
    'memories': '记忆端点：对话历史查询',
  };

  if (purposeMap[filename]) return purposeMap[filename];
  if (purposeMap[dir]) return purposeMap[dir];

  // 基于导出符号推断
  if (exports.some(e => e.includes('create') || e.includes('init') || e.includes('setup'))) {
    return '工厂函数：创建路由器或初始化模块';
  }
  if (exports.some(e => e.includes('Router'))) {
    return 'Express 路由器模块';
  }
  if (exports.some(e => e.includes('class') || e.includes('Class'))) {
    return '类定义模块';
  }

  return '辅助/类型定义模块';
}

/**
 * 解析相对导入路径为目标文件名。
 */
function resolveDep(fromRel: string, importPath: string): string | null {
  // 去掉 ./ 前缀
  let resolved = importPath.startsWith('./') || importPath.startsWith('../')
    ? path.normalize(path.join(path.dirname(fromRel), importPath))
    : importPath;

  // 标准化
  resolved = resolved.replace(/\\/g, '/');

  // 去掉 .js 扩展名（TypeScript 编译后为 .js）
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3) + '.ts';
  } else if (!resolved.endsWith('.ts')) {
    resolved += '.ts';
  }

  // 检查是否存在
  const fullPath = path.join(BACKEND_ROOT, resolved);
  if (fs.existsSync(fullPath)) return resolved;

  // 检查 index.ts
  const indexDir = path.join(BACKEND_ROOT, resolved.replace(/\.ts$/, ''), 'index.ts');
  if (fs.existsSync(indexDir)) return resolved.replace(/\.ts$/, '/index.ts');

  // 检查 .js 文件
  const jsPath = path.join(BACKEND_ROOT, resolved.replace(/\.ts$/, '.js'));
  if (fs.existsSync(jsPath)) return resolved.replace(/\.ts$/, '.js');

  // 外部依赖（node_modules 或绝对路径）——不追踪
  return null;
}

/**
 * 清除扫描缓存（当文件变更时）。
 */
export function invalidateScanCache(): void {
  scanCache = null;
}

/**
 * 获取代码统计概要。
 */
export function getCodeStats(): {
  totalFiles: number;
  totalLines: number;
  totalSizeKB: number;
  modules: Record<string, number>;
  topFiles: Array<{ path: string; lines: number }>;
} {
  const scan = scanBackend();
  const topFiles = [...scan.files]
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 10)
    .map(f => ({ path: f.relativePath, lines: f.lineCount }));

  return {
    totalFiles: scan.totalFiles,
    totalLines: scan.totalLines,
    totalSizeKB: Math.round(scan.totalSizeBytes / 1024),
    modules: scan.moduleStats,
    topFiles,
  };
}

// ══════════════════════════════════════════════════════════════════
// 工具定义（供 Function Calling 注册）
// ══════════════════════════════════════════════════════════════════

/**
 * 返回 self-scan 工具定义，供 chat.ts 注册到 DeepSeek Function Calling。
 */
export function getSelfScanToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'self_scan',
      description: '扫描和查询 mainfold-agent 自身的代码结构。当你需要理解自己的架构、文件布局、模块用途或依赖关系时调用此工具。返回结构化代码索引。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['scan', 'files', 'file_detail', 'read-file', 'deps', 'stats', 'query', 'list-actions'],
            description: '要执行的自省操作：scan=完整扫描, files=文件列表, file_detail或read-file=单个文件详情, deps=依赖图, stats=统计, query=自然语言查询, list-actions=列出所有可用操作',
          },
          filePath: {
            type: 'string',
            description: 'read-file/file_detail 操作时需要：目标文件的相对路径（相对于 src/backend/）。也可用 file 参数代替。',
          },
          file: {
            type: 'string',
            description: 'read-file/file_detail 操作时的文件路径别名（与 filePath 等价，二选一）。',
          },
          query: {
            type: 'string',
            description: 'query 操作时需要：自然语言查询，例如"哪里定义了createChatRouter"或"chat.ts有哪些导出函数"',
          },
        },
        required: ['action'],
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// 自省执行器（供 chat.ts Function Calling 调用）
// ══════════════════════════════════════════════════════════════════

/**
 * 执行 self-scan 相关的工具调用。
 * 返回格式化为 JSON 字符串的结果。
 */
export async function executeSelfScan(args: {
  action: string;
  filePath?: string;
  query?: string;
}): Promise<string> {
  const { action } = args;

  switch (action) {
    case 'scan': {
      const scan = scanBackend();
      return JSON.stringify({
        totalFiles: scan.totalFiles,
        totalLines: scan.totalLines,
        totalSizeKB: Math.round(scan.totalSizeBytes / 1024),
        moduleStats: scan.moduleStats,
        topFiles: scan.depGraph.nodes.slice(0, 10),
        scannedAt: scan.scannedAt,
      }, null, 2);
    }

    case 'files': {
      const scan = scanBackend();
      const fileList = scan.files.map(f => ({
        path: f.relativePath,
        type: f.moduleType,
        lines: f.lineCount,
        exports: f.exports,
        purpose: f.purpose,
      }));
      return JSON.stringify({ count: fileList.length, files: fileList }, null, 2);
    }

    case 'file_detail':
    case 'read-file': {
      const targetPath = args.filePath || args.file || '';
      if (!targetPath) {
        return JSON.stringify({ error: 'filePath 或 file 参数是必需的' });
      }
      const scan = scanBackend();
      const file = scan.files.find(f =>
        f.relativePath === targetPath ||
        f.relativePath.endsWith('/' + targetPath) ||
        f.relativePath.endsWith('\\' + targetPath)
      );
      if (!file) {
        return JSON.stringify({ error: `File not found: ${targetPath}`, availableFiles: scan.files.map(f => f.relativePath) });
      }
      // 真正读取文件内容
      let content = '';
      try {
        content = fs.readFileSync(file.absolutePath, 'utf-8');
        // 截断超大文件，防止撑爆 Function Calling 响应
        const MAX_CONTENT_CHARS = 200000;
        if (content.length > MAX_CONTENT_CHARS) {
          content = content.slice(0, MAX_CONTENT_CHARS) +
            `\n\n... [截断：文件共 ${content.length} 字符，仅显示前 ${MAX_CONTENT_CHARS}]`;
        }
      } catch (e) {
        content = `[读取失败: ${(e as Error).message}]`;
      }
      return JSON.stringify({
        ...file,
        content,
      }, null, 2);
    }

    case 'deps': {
      const scan = scanBackend();
      return JSON.stringify({
        nodes: scan.depGraph.nodes,
        edgeCount: scan.depGraph.edges.length,
        edges: scan.depGraph.edges,
      }, null, 2);
    }

    case 'stats': {
      const stats = getCodeStats();
      return JSON.stringify(stats, null, 2);
    }

    case 'query': {
      // 使用 SICR 方式进行代码查询
      const scan = scanBackend();
      const candidatePool = scan.files.map(f => ({
        id: f.relativePath,
        text: `File: ${f.relativePath}\nModuleType: ${f.moduleType}\nExports: ${f.exports.join(', ')}\nPurpose: ${f.purpose}`,
        metadata: { lines: f.lineCount, imports: f.imports.length },
      }));

      // 如果 SICR 可用，使用语义排名
      try {
        const { rankCandidates } = await import('./sicr-router.js');
        const sicrResult = await rankCandidates(args.query || '', candidatePool, {
          topK: 5,
          minScore: 0.3,
        });
        return JSON.stringify({
          query: args.query,
          results: sicrResult.results.map(r => ({
            file: r.id,
            score: r.score,
          })),
          totalFiles: scan.totalFiles,
        }, null, 2);
      } catch {
        // SICR 不可用时的降级：关键词匹配 + 导出符号匹配
        const keyword = (args.query || '').toLowerCase();
        const matched = candidatePool
          .filter(c => c.text.toLowerCase().includes(keyword))
          .slice(0, 5)
          .map(c => ({ file: c.id, matchType: 'keyword' }));
        return JSON.stringify({
          query: args.query,
          results: matched,
          totalFiles: scan.totalFiles,
          note: 'SICR 不可用，使用关键词降级匹配',
        }, null, 2);
      }
    }

    case 'list-actions':
      return JSON.stringify({
        availableActions: [
          { action: 'scan', description: '完整扫描（文件数/行数/模块统计/前10文件列表）' },
          { action: 'files', description: '文件列表（路径/类型/行数/导出符号/用途）' },
          { action: 'file_detail', aliases: ['read-file'], params: { filePath: '相对路径' }, description: '单个文件详细信息' },
          { action: 'deps', description: '依赖图（节点+边）' },
          { action: 'stats', description: '代码统计数据' },
          { action: 'query', params: { query: '自然语言' }, description: '自然语言查询代码' },
          { action: 'list-actions', description: '列出此信息' },
        ],
      }, null, 2);

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Use action=list-actions to see all available actions.` });
  }
}

// ══════════════════════════════════════════════════════════════════
// Express 路由器
// ══════════════════════════════════════════════════════════════════

export function createSelfScanRouter(): Router {
  const router = Router();

  // ════════════════════════════════════════════════
  // GET /api/self/scan — 触发完整扫描（或返回缓存）
  // ════════════════════════════════════════════════

  router.get('/api/self/scan', async (_req: Request, res: Response) => {
    try {
      // 支持 force 参数强制刷新
      if (_req.query.force === 'true') {
        invalidateScanCache();
      }
      const scan = scanBackend();
      res.json({
        scannedAt: scan.scannedAt,
        totalFiles: scan.totalFiles,
        totalLines: scan.totalLines,
        totalSizeKB: Math.round(scan.totalSizeBytes / 1024),
        moduleStats: scan.moduleStats,
        topFiles: scan.depGraph.nodes.slice(0, 20),
      });
    } catch (err) {
      const error = err as Error;
      console.error(`[self-scan] Scan failed: ${error.message}`);
      res.status(500).json({ error: 'Self-scan failed', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // GET /api/self/files — 文件列表
  // ════════════════════════════════════════════════

  router.get('/api/self/files', (_req: Request, res: Response) => {
    try {
      const scan = scanBackend();
      const files = scan.files.map(f => ({
        path: f.relativePath,
        type: f.moduleType,
        lines: f.lineCount,
        sizeKB: Math.round(f.sizeBytes / 1024),
        exports: f.exports,
        purpose: f.purpose,
        lastModified: f.lastModified,
      }));
      res.json({ count: files.length, files });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: 'Failed to list files', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // GET /api/self/file/:path — 单个文件详情
  // ════════════════════════════════════════════════

  router.get('/api/self/file/*', (req: Request, res: Response) => {
    try {
      // Express 路由中的 * 捕获完整路径
      const paths = req.params[0] as string | undefined;
      if (!paths) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      const scan = scanBackend();
      const filePath = paths.replace(/\\/g, '/');
      const file = scan.files.find(f => f.relativePath === filePath || f.relativePath.endsWith(filePath));

      if (!file) {
        res.status(404).json({ error: `File not found: ${filePath}` });
        return;
      }

      // 读取文件内容前 50 行作为预览
      let contentPreview = '';
      try {
        const content = fs.readFileSync(file.absolutePath, 'utf-8');
        const lines = content.split('\n');
        contentPreview = lines.slice(0, 50).join('\n');
      } catch {
        contentPreview = '(unreadable)';
      }

      res.json({
        ...file,
        contentPreview,
      });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: 'Failed to get file details', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // GET /api/self/deps — 依赖图
  // ════════════════════════════════════════════════

  router.get('/api/self/deps', (_req: Request, res: Response) => {
    try {
      const scan = scanBackend();
      res.json({
        nodeCount: scan.depGraph.nodes.length,
        edgeCount: scan.depGraph.edges.length,
        edges: scan.depGraph.edges,
      });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: 'Failed to get dependency graph', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // GET /api/self/stats — 代码统计
  // ════════════════════════════════════════════════

  router.get('/api/self/stats', (_req: Request, res: Response) => {
    try {
      const stats = getCodeStats();
      res.json(stats);
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: 'Failed to get stats', detail: error.message });
    }
  });

  // ════════════════════════════════════════════════
  // POST /api/self/query — 自然语言代码查询（SICR）
  // ════════════════════════════════════════════════

  router.post('/api/self/query', async (req: Request, res: Response) => {
    try {
      const { query, topK } = req.body as SelfQueryRequest;

      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'query (string) is required' });
        return;
      }

      const result = await executeSelfScan({ action: 'query', query, filePath: undefined });
      const parsed = JSON.parse(result);
      res.json(parsed);
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: 'Query failed', detail: error.message });
    }
  });

  return router;
}
