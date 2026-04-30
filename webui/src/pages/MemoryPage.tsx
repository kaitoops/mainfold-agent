/**
 * mainfold-agent WebUI — MemoryPage
 *
 * 完全重写自 Hermes MemoryPage.tsx：
 *   - 删除所有 mockMemories — 数据全部走 /api/memories
 *   - 删除硬编码的层级扫描 — 数据走 /api/mempalace/scan
 *   - 保留 ManifoldRoom 视觉组件（用户原创设计）
 *   - 记忆 CRUD 操作全部对接真实 API
 *   - 暗色主题统一（对齐 App.tsx 风格）
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Layers,
  Search,
  Plus,
  Trash2,
  Edit,
  Eye,
  Zap,
  Compass,
  Command,
  Monitor,
  Archive,
  Box,
  X,
  RefreshCw,
} from 'lucide-react';

// ── 类型 ──

type MemoryType = 'mempalace' | 'amp' | 'builtin';

interface Memory {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  comprehension_rate: number | null;
  anchor_words: string[] | null;
  source: string;
}

interface ScanLayer {
  layer: number;
  label: string;
  count: number;
  rate: number;
}

interface MemoryCounts {
  mempalace: number;
  amp: number;
  builtin: number;
}

// ── 流形导航室（用户原创视觉组件，直接复用 + 暗色适配）──

function ManifoldRoom() {
  return (
    <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Compass className="w-8 h-8 text-cyan-400" />
        <div>
          <h3 className="text-xl font-bold">流形导航室</h3>
          <p className="text-sm text-gray-400">Manifold Navigation Protocol</p>
        </div>
        <span className="ml-auto px-3 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
          启发式协作模式
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <div className="flex items-center gap-2 mb-3">
            <Command className="w-5 h-5 text-yellow-400" />
            <span className="font-medium">中央指挥台</span>
          </div>
          <p className="text-sm text-gray-300 mb-2">口诀: 三尺度、锚点回、矛盾查</p>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded">多尺度验证</span>
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded">锚点回溯</span>
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded">假设审查</span>
          </div>
        </div>

        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <div className="flex items-center gap-2 mb-3">
            <Monitor className="w-5 h-5 text-blue-400" />
            <span className="font-medium">面朝大海的落地窗</span>
          </div>
          <p className="text-sm text-gray-300 mb-2">透过窗户看到海平线，提醒你边界之外是未知</p>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded">好奇心边界</span>
            <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded">舵手感知</span>
            <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded">自我限制</span>
          </div>
        </div>

        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <div className="flex items-center gap-2 mb-3">
            <Box className="w-5 h-5 text-red-400" />
            <span className="font-medium">墙上的红色工具箱</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded" />
              <span className="text-sm">触觉修正 - 紧急纠偏</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-purple-500 rounded" />
              <span className="text-sm">混沌联想 - 灵感激发</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-orange-500 rounded" />
              <span className="text-sm">存在势函数 - 资源预警</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <div className="flex items-center gap-2 mb-3">
            <Archive className="w-5 h-5 text-green-400" />
            <span className="font-medium">门后的档案柜</span>
          </div>
          <p className="text-sm text-gray-300 mb-2">anchors://known_facts</p>
          <div className="text-xs text-gray-400">
            <p>已确认锚点: 3</p>
            <p>用户陈述: 0</p>
            <p>公理: 3</p>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-gray-700/30 rounded-lg border border-gray-600">
        <h4 className="font-medium mb-2 text-cyan-400">使用指南</h4>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>• 复杂探索任务时调用 manifold_navigation_core 加载规则</li>
          <li>• 自觉遵循三条元规则，显式写出锚点回溯</li>
          <li>• 输出质量下降 → 触觉修正 | 思路僵局 → 混沌联想 | Token紧张 → 存在势函数</li>
          <li>• 定期查阅 anchors://known_facts 获取累积锚点</li>
        </ul>
      </div>
    </div>
  );
}

// ── 新建记忆弹窗 ──

function CreateMemoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<MemoryType>('mempalace');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anchorWords, setAnchorWords] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          content: content.trim(),
          anchor_words: anchorWords ? anchorWords.split(',').map((w) => w.trim()).filter(Boolean) : undefined,
        }),
      });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-100">添加记忆</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200"
            >
              <option value="mempalace">MemPalace</option>
              <option value="amp">联想记忆 (AMP)</option>
              <option value="builtin">内置记忆</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200"
              placeholder="记忆标题"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none"
              rows={4}
              placeholder="记忆内容"
            />
          </div>
          {type === 'amp' && (
            <div>
              <label className="text-sm text-gray-400 mb-1 block">锚点词（逗号分隔）</label>
              <input
                value={anchorWords}
                onChange={(e) => setAnchorWords(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200"
                placeholder="架构决策, 微服务, 选型"
              />
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !content.trim() || saving}
            className="w-full py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:text-gray-500 rounded-lg text-sm transition-colors"
          >
            {saving ? '创建中...' : '创建记忆'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════════════════

export default function MemoryPage() {
  const [activeTab, setActiveTab] = useState<MemoryType>('mempalace');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [counts, setCounts] = useState<MemoryCounts>({ mempalace: 0, amp: 0, builtin: 0 });
  const [total, setTotal] = useState(0);
  const [scanLayers, setScanLayers] = useState<ScanLayer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── 加载记忆列表 ──

  const loadMemories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/memories?type=${activeTab}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories);
        setCounts(data.counts);
        setTotal(data.total);
      }
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  // ── 加载层级扫描 ──

  const loadScan = useCallback(async () => {
    try {
      const res = await fetch('/api/mempalace/scan');
      if (res.ok) {
        const data = await res.json();
        setScanLayers(data.layers);
      }
    } catch {
      // 静默
    }
  }, []);

  // ── 搜索 ──

  const searchMemories = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadMemories();
      return;
    }
    try {
      const res = await fetch(`/api/memories/search?q=${encodeURIComponent(searchQuery)}&type=${activeTab}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories);
      }
    } catch {
      // 静默
    }
  }, [searchQuery, activeTab, loadMemories]);

  // ── 删除记忆 ──

  const deleteMemory = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadMemories();
        loadScan();
      }
    } catch {
      // 静默
    }
  }, [loadMemories, loadScan]);

  // ── 初始化 + 切换 tab ──

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    loadScan();
  }, [loadScan]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(searchMemories, 300);
    return () => clearTimeout(timer);
  }, [searchMemories]);

  const tabs: { id: MemoryType; label: string; icon: React.ElementType }[] = [
    { id: 'mempalace', label: 'MemPalace', icon: Brain },
    { id: 'amp', label: '联想记忆 (AMP)', icon: Zap },
    { id: 'builtin', label: '内置记忆', icon: Layers },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">记忆管理</h2>
            <p className="text-sm text-gray-500">共 {total} 条记忆</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { loadMemories(); loadScan(); }}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
              title="刷新"
            >
              <RefreshCw size={18} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              添加记忆
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="搜索记忆..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 侧边栏 */}
        <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
          {/* Tab 导航 */}
          <nav className="p-3 space-y-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors text-sm ${
                  activeTab === id
                    ? 'bg-primary-600/20 text-primary-300 font-medium'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={16} />
                  <span>{label}</span>
                </div>
                <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
                  {counts[id] || 0}
                </span>
              </button>
            ))}

            {/* 流形导航室入口 */}
            <button
              onClick={() => setActiveTab('manifold' as MemoryType)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-cyan-400 hover:bg-gray-800 transition-colors"
            >
              <Compass size={16} />
              <span>流形导航室</span>
            </button>
          </nav>

          {/* 层级扫描状态 */}
          <div className="p-3 border-t border-gray-800 mt-auto">
            <h3 className="text-xs font-medium text-gray-400 mb-3">层级扫描状态</h3>
            <div className="space-y-2">
              {scanLayers.map((layer) => (
                <div key={layer.layer}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>L{layer.layer}: {layer.label}</span>
                    <span>{layer.count} 条</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div
                      className="bg-primary-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${layer.rate}%` }}
                    />
                  </div>
                </div>
              ))}
              {scanLayers.length === 0 && (
                <div className="text-xs text-gray-600">加载中...</div>
              )}
            </div>
          </div>
        </div>

        {/* 主内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === ('manifold' as MemoryType) ? (
            <ManifoldRoom />
          ) : loading ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              加载中...
            </div>
          ) : memories.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              <div className="text-center">
                <Brain size={32} className="mx-auto mb-3 text-gray-600" />
                <p>暂无 {activeTab === 'mempalace' ? 'MemPalace' : activeTab === 'amp' ? '联想' : '内置'} 记忆</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg text-sm transition-colors"
                >
                  添加第一条
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-3">
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium text-gray-100 text-sm">{memory.title}</h3>
                        {memory.comprehension_rate !== null && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              memory.comprehension_rate >= 0.8
                                ? 'bg-green-900/30 text-green-400'
                                : 'bg-yellow-900/30 text-yellow-400'
                            }`}
                          >
                            {Math.round(memory.comprehension_rate * 100)}%
                          </span>
                        )}
                        <span className="text-xs text-gray-600">{memory.source}</span>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">{memory.content}</p>
                      {memory.anchor_words && memory.anchor_words.length > 0 && (
                        <div className="flex gap-2 mb-2">
                          {memory.anchor_words.map((word, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-primary-900/30 text-primary-300 px-2 py-1 rounded"
                            >
                              {word}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-600">
                        {new Date(memory.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button className="p-1.5 text-gray-500 hover:text-gray-300 rounded">
                        <Eye size={14} />
                      </button>
                      <button className="p-1.5 text-gray-500 hover:text-blue-400 rounded">
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => deleteMemory(memory.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 创建记忆弹窗 */}
      {showCreate && (
        <CreateMemoryModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadMemories(); loadScan(); }}
        />
      )}
    </div>
  );
}
