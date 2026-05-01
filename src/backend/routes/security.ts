/**
 * mainfold-agent — Security 路由 (前端 SecurityPage 数据源)
 *
 * 旧项目状态：前端 SecurityPage 调用 /api/security/settings 和 /api/security/config
 *            但后端完全没有实现这些端点
 * 新项目策略：基于配置文件 + 内存状态提供真实安全配置
 *
 * 安全配置来源：
 *   - 硬编码的安全基线（blocked_commands, protected_paths）
 *   - 可切换的设置项（toggle/select）
 *   - 配置持久化到 JSON 文件
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../../../config/security-config.json');

// ── 安全基线（不可修改的硬编码规则）──

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'mkfs',
  'dd if=/dev/zero',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'wget.*|.*sh',
  'curl.*|.*sh',
];

const PROTECTED_PATHS = [
  '~/.ssh',
  '~/.gnupg',
  '/etc/shadow',
  '/etc/passwd',
  '~/.env',
  '~/.aws',
  '~/.config/gcloud',
];

// ── 额外路径白名单（持久化 JSON）──

interface AllowedPathsData {
  paths: string[];
  updated_at: string;
}

const ALLOWED_PATHS_FILE = path.resolve(__dirname, '../../../config/allowed-paths.json');

function loadAllowedPaths(): string[] {
  if (!fs.existsSync(ALLOWED_PATHS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWED_PATHS_FILE, 'utf-8')) as AllowedPathsData;
    return data.paths || [];
  } catch {
    return [];
  }
}

function saveAllowedPath(absolutePath: string): void {
  const paths = loadAllowedPaths();
  const normalized = path.resolve(absolutePath); // 规范化路径
  if (!paths.includes(normalized)) {
    paths.push(normalized);
    const dir = path.dirname(ALLOWED_PATHS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ALLOWED_PATHS_FILE, JSON.stringify({ paths, updated_at: new Date().toISOString() }, null, 2));
  }
}

/** 检查绝对路径是否在白名单内（前缀匹配，允许子目录） */
export function isPathAllowed(absolutePath: string): boolean {
  const allowedPaths = loadAllowedPaths();
  const normalized = path.resolve(absolutePath);
  return allowedPaths.some(p => normalized.startsWith(p));
}

/** 添加路径到白名单（持久化） */
export function addAllowedPath(absolutePath: string): void {
  saveAllowedPath(absolutePath);
}

/** 获取所有白名单路径 */
export function getAllowedPaths(): string[] {
  return loadAllowedPaths();
}

// ── 可配置设置项 ──

interface SecuritySetting {
  id: string;
  label: string;
  description: string;
  value: boolean | string;
  type: 'toggle' | 'select';
  options?: string[];
}

const DEFAULT_SETTINGS: SecuritySetting[] = [
  {
    id: 'auto_approve_read',
    label: '自动批准只读操作',
    description: '文件读取、列表、搜索等只读操作无需人工确认',
    value: true,
    type: 'toggle',
  },
  {
    id: 'require_confirm_write',
    label: '写入操作需确认',
    description: '文件修改、创建等写入操作需要人工确认',
    value: true,
    type: 'toggle',
  },
  {
    id: 'block_external_network',
    label: '阻止外部网络访问',
    description: '禁止 Agent 主动发起外部 HTTP 请求（API 调用除外）',
    value: false,
    type: 'toggle',
  },
  {
    id: 'execution_mode',
    label: '执行模式',
    description: '控制 Agent 的自主执行级别',
    value: 'standard',
    type: 'select',
    options: ['restricted', 'standard', 'full'],
  },
  {
    id: 'log_all_actions',
    label: '记录所有操作',
    description: '将 Agent 的每个操作记录到审计日志',
    value: true,
    type: 'toggle',
  },
];

// ── 配置持久化 ──

function loadConfig(): SecuritySetting[] {
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_SETTINGS;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    // 合并：以 DEFAULT_SETTINGS 为基线，覆盖已保存的值
    return DEFAULT_SETTINGS.map((def) => {
      const saved = data.settings?.find((s: SecuritySetting) => s.id === def.id);
      return saved ? { ...def, value: saved.value } : def;
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveConfig(settings: SecuritySetting[]): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ settings, updated_at: new Date().toISOString() }, null, 2));
}

// ── 请求验证 ──

const UpdateSettingSchema = z.object({
  value: z.union([z.boolean(), z.string()]),
});

// ── 路由器 ──

export function createSecurityRouter(): Router {
  const router = Router();

  // GET /api/security/settings — 获取所有设置
  router.get('/api/security/settings', (_req: Request, res: Response) => {
    const settings = loadConfig();
    res.json(settings);
  });

  // GET /api/security/config — 获取安全配置概览
  router.get('/api/security/config', (_req: Request, res: Response) => {
    res.json({
      security: {
        blocked_commands: BLOCKED_COMMANDS,
        blocked_paths: PROTECTED_PATHS,
        status: 'enabled',
        mode: 'standard',
      },
    });
  });

  // POST /api/security/settings/:id — 更新单个设置
  router.post('/api/security/settings/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const parsed = UpdateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid value', details: parsed.error.issues });
      return;
    }

    const settings = loadConfig();
    const setting = settings.find((s) => s.id === id);
    if (!setting) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }

    // 类型校验
    if (setting.type === 'toggle' && typeof parsed.data.value !== 'boolean') {
      res.status(400).json({ error: 'Toggle setting requires boolean value' });
      return;
    }
    if (setting.type === 'select' && setting.options && !setting.options.includes(parsed.data.value as string)) {
      res.status(400).json({ error: `Invalid option. Valid: ${setting.options.join(', ')}` });
      return;
    }

    setting.value = parsed.data.value;
    saveConfig(settings);

    res.json({ id, value: setting.value, status: 'updated' });
  });

  return router;
}
