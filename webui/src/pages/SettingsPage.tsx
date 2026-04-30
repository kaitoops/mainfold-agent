/**
 * mainfold-agent WebUI — SettingsPage
 *
 * 重写自 Hermes SettingsPage.tsx：
 *   - 旧版支持3个 provider（siliconflow/deepseek/openrouter）+ Gateway
 *   - 新版简化为纯 DeepSeek（当前阶段）+ API Key 从 .env 读取
 *   - 对接 /api/models（已有）+ /api/models/active（已补）
 *   - 暗色主题统一
 *   - 测试连接逻辑保留：临时切换模型→发测试请求→切回
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Globe,
  Database,
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';

// ── 类型 ──

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  context?: string;
}

interface ModelsConfig {
  providers: {
    deepseek: {
      models: ModelInfo[];
    };
  };
}

// ── 主组件 ──

export default function SettingsPage() {
  const [config, setConfig] = useState<ModelsConfig | null>(null);
  const [activeModel, setActiveModel] = useState('deepseek-v4-flash');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [apiKeyStatus, setApiKeyStatus] = useState<'unknown' | 'configured' | 'missing'>('unknown');

  // ── 加载模型配置 + 活跃模型 ──

  useEffect(() => {
    Promise.all([
      fetch('/api/models').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/models/active').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([modelsData, activeData]) => {
        if (modelsData) setConfig(modelsData);
        if (activeData) setActiveModel(activeData.active_model);
      })
      .catch(() => {});

    // 检查 API Key 状态
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.services?.deepseek_api === 'configured') {
          setApiKeyStatus('configured');
        } else {
          setApiKeyStatus('missing');
        }
      })
      .catch(() => {});
  }, []);

  // ── 保存活跃模型 ──

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/models/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: activeModel }),
      });
      if (res.ok) setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }, [activeModel]);

  // ── 测试连接 ──

  const testConnection = useCallback(async () => {
    setTestStatus('testing');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '请回复 OK 以确认系统正常工作',
          model: activeModel,
          conversation_history: [],
        }),
      });
      setTestStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 5000);
  }, [activeModel]);

  const statusIcon = (status: string) => {
    if (status === 'testing') return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
    if (status === 'ok') return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (status === 'fail') return <XCircle className="w-4 h-4 text-red-400" />;
    return null;
  };

  const models = config?.providers?.deepseek?.models || [];

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
            <Settings className="w-5 h-5 text-gray-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-100">设置</h2>
            <p className="text-sm text-gray-500">配置模型选择和 API Key</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 模型选择 */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg">
            <div className="p-4 border-b border-gray-700 flex items-center gap-2">
              <Globe className="w-5 h-5 text-gray-400" />
              <h3 className="font-medium text-gray-100">模型选择</h3>
            </div>
            <div className="p-4">
              <div className="text-sm text-gray-400 mb-3">DeepSeek（当前唯一 Provider）</div>
              <div className="grid grid-cols-2 gap-3">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setActiveModel(m.id)}
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      activeModel === m.id
                        ? 'border-primary-500 bg-primary-900/20'
                        : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                    }`}
                  >
                    <div className="font-medium text-gray-100 text-sm">{m.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{m.description || '—'}</div>
                    {m.context && (
                      <div className="text-xs text-gray-600 mt-1">上下文: {m.context}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* API Key 配置 */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg">
            <div className="p-4 border-b border-gray-700 flex items-center gap-2">
              <Database className="w-5 h-5 text-gray-400" />
              <h3 className="font-medium text-gray-100">API Key 配置</h3>
              <span className="text-xs text-gray-600 ml-auto">环境变量: DEEPSEEK_API_KEY</span>
            </div>
            <div className="p-4">
              <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-gray-200 text-sm">DeepSeek</div>
                    <div className="text-xs text-gray-500 mt-1">
                      状态:{' '}
                      <span
                        className={
                          apiKeyStatus === 'configured'
                            ? 'text-green-400'
                            : apiKeyStatus === 'missing'
                              ? 'text-red-400'
                              : 'text-gray-500'
                        }
                      >
                        {apiKeyStatus === 'configured'
                          ? '已配置'
                          : apiKeyStatus === 'missing'
                            ? '未配置'
                            : '检测中...'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusIcon(testStatus)}
                    <button
                      onClick={testConnection}
                      disabled={testStatus === 'testing' || apiKeyStatus === 'missing'}
                      className="text-xs px-3 py-1.5 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-gray-300"
                    >
                      测试连接
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyValue}
                    onChange={(e) => setApiKeyValue(e.target.value)}
                    placeholder="输入 DEEPSEEK_API_KEY（不修改请留空）"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 placeholder-gray-600"
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="px-3 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4 text-gray-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>
                {apiKeyValue && (
                  <div className="text-xs text-yellow-500 mt-2">
                    注意：修改 .env 文件后需重启后端生效
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="flex items-center gap-1.5 text-green-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                已保存
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
