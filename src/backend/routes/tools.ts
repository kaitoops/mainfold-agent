/**
 * mainfold-agent — 工具路由模块 (Phase D)
 *
 * 为 mainfold-agent 提供 WorkBuddy 级别的工具能力：
 *   exec       — 执行 shell 命令（沙箱在 shared-workspace）
 *   read-file  — 读取文件
 *   write-file — 写文件
 *   ls         — 列出目录
 *   git        — Git 操作
 *   http       — HTTP 请求（只读 POST/GET）
 *
 * 这些端点被 chat.ts 的 function calling 循环调用，
 * 使 DeepSeek 能自主执行工具。
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { exec as childExec } from 'child_process';
import type { ColdMemory } from '../memory/cold-db.js';
import type { WarmIndex } from '../memory/warm-index.js';
import { isPathAllowed } from './security.js';
import { pushPermissionRequest } from './inject.js';

// ── 沙箱路径 ──

const SHARED_WORKSPACE = process.env.TOOLS_SHARED_WORKSPACE || 'G:\\shared-workspace';

/** 确保路径在沙箱内。toolName 仅用于权限请求日志 */
function safeResolve(userPath: string, toolName?: string): string {
  // 绝对路径：查白名单
  if (path.isAbsolute(userPath)) {
    if (isPathAllowed(userPath)) {
      // 在白名单内，直接返回解析后的路径
      return userPath;
    }
    // 不在白名单 → 推送到注入队列请求审批
    pushPermissionRequest(userPath, toolName || 'unknown');
    throw new Error(
      `Permission required: ${userPath} is not in the allowed paths whitelist. ` +
      `A permission request has been sent to the user via the inject queue. ` +
      `The user must add this path to allowed_extra_paths before retrying.`
    );
  }
  const normalized = path.normalize(userPath);
  if (normalized.startsWith('..')) {
    throw new Error(`Path escape attempt: ${userPath}`);
  }
  if (/[:*?"<>|]/.test(normalized)) {
    throw new Error(`Invalid path characters: ${userPath}`);
  }
  const resolved = path.resolve(SHARED_WORKSPACE, normalized);
  // 再次验证最终路径在沙箱内
  if (!resolved.startsWith(path.resolve(SHARED_WORKSPACE))) {
    throw new Error(`Path escapes sandbox: ${userPath}`);
  }
  return resolved;
}

// ── 工具函数：执行 shell 命令（Promise 化） ──

function execCmd(command: string, cwd: string, timeoutMs: number = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    childExec(command, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error ? (error as any).code || 1 : 0,
      });
    });
  });
}

// ── 路由器 ──

export function createToolsRouter(deps?: {
  coldMemory?: ColdMemory;
  warmIndex?: WarmIndex;
}): Router {
  const router = Router();

  // 确保沙箱目录存在
  if (!fs.existsSync(SHARED_WORKSPACE)) {
    fs.mkdirSync(SHARED_WORKSPACE, { recursive: true });
  }

  // ── POST /api/tools/exec ──

  router.post('/api/tools/exec', async (req: Request, res: Response) => {
    try {
      const { command, timeout } = req.body as { command?: string; timeout?: number };
      const execStart = Date.now();
      if (!command || typeof command !== 'string') {
        res.status(400).json({ error: 'command (string) is required' });
        return;
      }

      // 安全警告：命令本身不会被沙箱限制（user 可以在命令中 cd 到任何位置）
      // 但默认 cwd 设置在沙箱内
      const result = await execCmd(command, SHARED_WORKSPACE, timeout || 30000);
      const execDuration = Date.now() - execStart;

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'exec',
            arguments_summary: command.slice(0, 300),
            result_summary: `exit=${result.exitCode} stdout=${(result.stdout || '').slice(0, 100)}`,
            exit_code: result.exitCode,
            duration_ms: execDuration,
          });
        } catch { /* silent */ }
      }

      res.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
      });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: error.message });
    }
  });

  // ── POST /api/tools/read-file ──

  router.post('/api/tools/read-file', async (req: Request, res: Response) => {
    try {
      const { filePath: readPath } = req.body as { filePath?: string };
      const readStart = Date.now();
      if (!readPath || typeof readPath !== 'string') {
        res.status(400).json({ error: 'filePath (string) is required' });
        return;
      }

      const safePath = safeResolve(readPath, 'read-file');
      if (!fs.existsSync(safePath)) {
        res.status(404).json({ error: `File not found: ${readPath}` });
        return;
      }

      const stat = fs.statSync(safePath);
      if (!stat.isFile()) {
        res.status(400).json({ error: `Not a file: ${readPath}` });
        return;
      }

      const content = fs.readFileSync(safePath, 'utf-8');

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'read-file',
            arguments_summary: readPath,
            result_summary: `size=${stat.size} preview=${content.slice(0, 80)}`,
            exit_code: null,
            duration_ms: Date.now() - readStart,
          });
        } catch { /* silent */ }
      }

      res.json({
        content,
        size: stat.size,
        path: readPath,
      });
    } catch (err) {
      const error = err as Error;
      res.status(400).json({ error: error.message });
    }
  });

  // ── POST /api/tools/write-file ──

  router.post('/api/tools/write-file', async (req: Request, res: Response) => {
    try {
      // BUGFIX 2026-05-02: 兼容 file / filePath 两种参数名
      // DeepSeek 模型经常输出 file 而非 filePath, chat.ts 有归一化层做转换
      // 但作为最后一道防线, tools 端点自身也接受 file 参数
      let { filePath: writePath, file: writeFileAlt, content: writeContent } = req.body as {
        filePath?: string; file?: string; content?: string;
      };
      if (!writePath && writeFileAlt) {
        writePath = writeFileAlt;
      }
      const writeStart = Date.now();
      if (!writePath || typeof writePath !== 'string') {
        res.status(400).json({ error: 'filePath (string) is required — use file or filePath parameter' });
        return;
      }
      if (writeContent === undefined || typeof writeContent !== 'string') {
        res.status(400).json({ error: 'content (string) is required' });
        return;
      }

      const safePath = safeResolve(writePath, 'write-file');
      // 确保目录存在
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(safePath, writeContent, 'utf-8');
      const writeSize = Buffer.byteLength(writeContent, 'utf-8');

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'write-file',
            arguments_summary: `${writePath} (${writeSize} bytes)`,
            result_summary: `written ${writeSize} bytes`,
            exit_code: null,
            duration_ms: Date.now() - writeStart,
          });
        } catch { /* silent */ }
      }

      res.json({
        success: true,
        size: writeSize,
        path: writePath,
      });
    } catch (err) {
      const error = err as Error;
      res.status(400).json({ error: error.message });
    }
  });

  // ── POST /api/tools/ls ──

  router.post('/api/tools/ls', async (req: Request, res: Response) => {
    try {
      const { dirPath: listDir } = req.body as { dirPath?: string };
      const lsStart = Date.now();
      const targetDir = listDir && typeof listDir === 'string' ? listDir : '.';
      const safePath = safeResolve(targetDir, 'ls');

      if (!fs.existsSync(safePath)) {
        res.status(404).json({ error: `Directory not found: ${targetDir}` });
        return;
      }

      const stat = fs.statSync(safePath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: `Not a directory: ${targetDir}` });
        return;
      }

      const entries = fs.readdirSync(safePath).map(name => {
        const fullPath = path.join(safePath, name);
        let type: 'file' | 'dir' | 'symlink' | 'other' = 'other';
        try {
          const st = fs.lstatSync(fullPath);
          if (st.isDirectory()) type = 'dir';
          else if (st.isFile()) type = 'file';
          else if (st.isSymbolicLink()) type = 'symlink';
        } catch {
          type = 'other';
        }
        const st = fs.statSync(fullPath);
        return {
          name,
          type,
          size: st.size,
          modified: st.mtime.toISOString(),
        };
      });

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'ls',
            arguments_summary: targetDir,
            result_summary: `${entries.length} entries (${entries.filter(e => e.type === 'file').length} files, ${entries.filter(e => e.type === 'dir').length} dirs)`,
            exit_code: null,
            duration_ms: Date.now() - lsStart,
          });
        } catch { /* silent */ }
      }

      res.json({
        path: targetDir,
        entries,
        total: entries.length,
      });
    } catch (err) {
      const error = err as Error;
      res.status(400).json({ error: error.message });
    }
  });

  // ── POST /api/tools/git ──

  router.post('/api/tools/git', async (req: Request, res: Response) => {
    try {
      const { dir, args } = req.body as { dir?: string; args?: string[] };
      const gitStart = Date.now();
      if (!args || !Array.isArray(args) || args.length === 0) {
        res.status(400).json({ error: 'args (string[]) is required' });
        return;
      }

      // 解析工作目录
      const workDir = dir && typeof dir === 'string'
        ? safeResolve(dir, 'git')
        : SHARED_WORKSPACE;

      // 构建 git 命令（安全：只允许安全参数，不允许管道/重定向）
      const unsafeArgs = args.filter(a => /[|;&<>$`]/.test(a));
      if (unsafeArgs.length > 0) {
        res.status(400).json({ error: `Unsafe git args detected: ${unsafeArgs.join(', ')}` });
        return;
      }

      const command = `git ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
      const result = await execCmd(command, workDir, 60000);
      const gitDuration = Date.now() - gitStart;

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'git',
            arguments_summary: args.join(' ').slice(0, 300),
            result_summary: `exit=${result.exitCode} stdout=${(result.stdout || '').slice(0, 100)}`,
            exit_code: result.exitCode,
            duration_ms: gitDuration,
          });
        } catch { /* silent */ }
      }

      res.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        dir: workDir,
      });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: error.message });
    }
  });

  // ── POST /api/tools/http ──

  router.post('/api/tools/http', async (req: Request, res: Response) => {
    try {
      const { method, url, headers, body } = req.body as {
        method?: string;
        url?: string;
        headers?: Record<string, string>;
        body?: string;
      };
      const httpStart = Date.now();

      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'url (string) is required' });
        return;
      }

      const httpMethod = (method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(httpMethod)) {
        res.status(400).json({ error: `Unsupported HTTP method: ${method}` });
        return;
      }

      const fetchOptions: RequestInit = {
        method: httpMethod,
        headers: headers || {},
      };

      if (body && ['POST', 'PUT'].includes(httpMethod)) {
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);
      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      const httpDuration = Date.now() - httpStart;

      // Phase E: 记录工具操作
      if (deps?.coldMemory) {
        try {
          deps.coldMemory.logToolOperation({
            session_id: null,
            tool_name: 'http',
            arguments_summary: `${httpMethod} ${(url || '').slice(0, 200)}`,
            result_summary: `status=${response.status} body=${responseBody.slice(0, 80)}`,
            exit_code: response.status >= 400 ? response.status : null,
            duration_ms: httpDuration,
          });
        } catch { /* silent */ }
      }

      res.json({
        status: response.status,
        status_text: response.statusText,
        headers: responseHeaders,
        body: responseBody.slice(0, 50000), // 限制 body 大小
        body_truncated: responseBody.length > 50000,
      });
    } catch (err) {
      const error = err as Error;
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
