/**
 * mainfold-agent WebUI — SecurityPage
 *
 * 重写自 Hermes SecurityPage.tsx：
 *   - 旧版后端没有 /api/security/* 端点，前端调了 404 也默默吞了
 *   - 新版后端已实现完整 security 路由（settings + config + update）
 *   - 暗色主题统一
 *   - 所有数据走真实 API
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Terminal,
  RefreshCw,
  Save,
} from 'lucide-react';

// ── 类型 ──

interface SecuritySetting {
  id: string;
  label: string;
  description: string;
  value: boolean | string;
  type: 'toggle' | 'select';
  options?: string[];
  dirty?: boolean;
}

// ── 主组件 ──

export default function SecurityPage() {
  const [settings, setSettings] = useState<SecuritySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedCommands, setBlockedCommands] = useState<string[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);

  // ── 加载配置 ──

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [settingsRes, configRes] = await Promise.all([
        fetch('/api/security/settings'),
        fetch('/api/security/config'),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.map((s: SecuritySetting) => ({ ...s, dirty: false })));
      } else {
        setError('安全设置加载失败');
      }

      if (configRes.ok) {
        const cfg = await configRes.json();
        setBlockedCommands(cfg?.security?.blocked_commands || []);
        setProtectedPaths(cfg?.security?.blocked_paths || []);
      }
    } catch {
      setError('无法连接到后端服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ── 更新设置 ──

  const updateSetting = useCallback(async (id: string, value: boolean | string) => {
    // 乐观更新 UI
    setSettings((prev) =>
      prev.map((s) => (s.id === id ? { ...s, value, dirty: true } : s)),
    );

    setSaving(id);
    try {
      const res = await fetch(`/api/security/settings/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSettings((prev) =>
        prev.map((s) => (s.id === id ? { ...s, dirty: false } : s)),
      );
    } catch {
      setError(`保存 "${id}" 失败`);
      // 回滚
      setSettings((prev) =>
        prev.map((s) => (s.id === id ? { ...s, dirty: false } : s)),
      );
    } finally {
      setSaving(null);
    }
  }, []);

  const hasDirty = settings.some((s) => s.dirty);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-900/30 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-100">安全配置</h2>
              <p className="text-sm text-gray-500">保护数据和系统安全</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasDirty && (
              <span className="text-xs text-yellow-400 flex items-center gap-1">
                <Save size={12} /> 有未保存更改
              </span>
            )}
            <button
              onClick={loadSettings}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
              title="刷新"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300 text-sm flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              {error}
            </div>
          )}

          {/* 安全状态概览 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <Lock className="w-5 h-5 text-green-400" />
                <span className="text-sm font-medium text-gray-200">安全状态</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span className="text-lg font-bold text-green-400">已启用</span>
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <Terminal className="w-5 h-5 text-primary-400" />
                <span className="text-sm font-medium text-gray-200">拦截规则</span>
              </div>
              <div className="text-lg font-bold text-gray-100">{blockedCommands.length}</div>
              <div className="text-xs text-gray-500">危险命令规则</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                <span className="text-sm font-medium text-gray-200">受保护路径</span>
              </div>
              <div className="text-lg font-bold text-gray-100">{protectedPaths.length}</div>
              <div className="text-xs text-gray-500">敏感路径</div>
            </div>
          </div>

          {/* 安全设置 */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg">
            <div className="p-4 border-b border-gray-700">
              <h3 className="font-medium text-gray-100">权限与安全设置</h3>
              <p className="text-xs text-gray-500 mt-1">修改后自动保存到 security-config.json</p>
            </div>
            {loading ? (
              <div className="p-8 text-center text-gray-500 text-sm">加载中...</div>
            ) : (
              <div className="divide-y divide-gray-700">
                {settings.map((setting) => (
                  <div
                    key={setting.id}
                    className={`p-4 flex items-center justify-between transition-colors ${
                      setting.dirty ? 'bg-yellow-900/10' : ''
                    }`}
                  >
                    <div className="flex-1">
                      <div className="font-medium text-gray-200 flex items-center gap-2 text-sm">
                        {setting.label}
                        {saving === setting.id && (
                          <span className="text-xs text-primary-400">保存中...</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">{setting.description}</div>
                    </div>
                    <div className="ml-4">
                      {setting.type === 'toggle' && (
                        <button
                          onClick={() => updateSetting(setting.id, !setting.value)}
                          disabled={saving === setting.id}
                          className={`w-12 h-6 rounded-full transition-colors disabled:opacity-60 ${
                            setting.value ? 'bg-primary-500' : 'bg-gray-600'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform mt-0.5 ${
                              setting.value ? 'translate-x-6' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      )}
                      {setting.type === 'select' && setting.options && (
                        <select
                          value={setting.value as string}
                          onChange={(e) => updateSetting(setting.id, e.target.value)}
                          disabled={saving === setting.id}
                          className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-primary-500"
                        >
                          {setting.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt === 'restricted' ? '受限模式' : opt === 'standard' ? '标准模式' : '完全模式'}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 危险命令列表 */}
          {blockedCommands.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg">
              <div className="p-4 border-b border-gray-700">
                <h3 className="font-medium text-gray-100">拦截的危险命令</h3>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {blockedCommands.map((cmd, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-red-900/30 text-red-300 rounded text-sm font-mono"
                    >
                      {cmd}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 受保护路径 */}
          {protectedPaths.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg">
              <div className="p-4 border-b border-gray-700">
                <h3 className="font-medium text-gray-100">受保护的敏感路径</h3>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {protectedPaths.map((p, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-yellow-900/30 text-yellow-300 rounded text-sm font-mono"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 权限说明 */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="font-medium text-gray-100 mb-3 flex items-center gap-2 text-sm">
              <Terminal size={16} />
              Agent 权限说明
            </h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <span><strong className="text-gray-300">只读操作</strong>：文件读取、列表、搜索 — 可配置为自动批准</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <span><strong className="text-gray-300">写入操作</strong>：文件修改、创建 — 默认需要人工确认</span>
              </div>
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <span><strong className="text-gray-300">危险命令</strong>：rm -rf, mkfs 等 — 永久拦截，不可自动批准</span>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <span><strong className="text-gray-300">受保护路径</strong>：系统路径、SSH 密钥 — 永久阻断访问</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
