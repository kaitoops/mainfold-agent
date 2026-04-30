/**
 * mainfold-agent WebUI — TriPage
 *
 * TRI-State 状态仪表盘
 * - 显示 A(活跃度) × S(命中率) × H(健康度) 三维状态
 * - TRI Score 及系统状态判定
 * - Health Ratio 恒温器实时数据
 * - 历史快照表格
 * - 支持手动更新三维状态
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Heart,
  Zap,
  RefreshCw,
  Sliders,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// ── 类型 ──

interface TriData {
  A: number;
  S: number;
  H: number;
  triScore: number;
  state: string;
  healthRatio: number;
  history: TriSnapshot[];
}

interface TriSnapshot {
  A: number;
  S: number;
  H: number;
  triScore: number;
  state: string;
  timestamp: string;
}

// ── 辅助 ──

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatScore(v: number): string {
  return v.toFixed(4);
}

function triStateColor(state: string): string {
  switch (state) {
    case 'NORMAL': return 'text-green-400';
    case 'DEGRADED': return 'text-yellow-400';
    case 'CRITICAL': return 'text-red-400';
    case 'OVERLOAD': return 'text-orange-400';
    case 'IDLE': return 'text-blue-400';
    default: return 'text-gray-400';
  }
}
// ── 维度进度条 ──

function DimBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = value * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400 font-mono">{formatPct(value)}</span>
      </div>
      <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── 主组件 ──

export default function TriPage() {
  const [triData, setTriData] = useState<TriData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editA, setEditA] = useState('');
  const [editS, setEditS] = useState('');
  const [editH, setEditH] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  // ── 加载数据 ──

  const loadTri = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tri');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTriData(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTri();
    const id = setInterval(loadTri, 10000); // 每 10 秒自动刷新
    return () => clearInterval(id);
  }, [loadTri]);

  // ── 手动更新三维状态 ──

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateMsg(null);
    try {
      const payload: Record<string, number> = {};
      if (editA) payload.A = parseFloat(editA);
      if (editS) payload.S = parseFloat(editS);
      if (editH) payload.H = parseFloat(editH);

      const res = await fetch('/api/tri', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTriData(data);
      setEditA('');
      setEditS('');
      setEditH('');
      setUpdateMsg('TRI 状态已更新');
      setTimeout(() => setUpdateMsg(null), 3000);
    } catch (err) {
      setUpdateMsg(`更新失败: ${(err as Error).message}`);
    } finally {
      setUpdating(false);
    }
  }, [editA, editS, editH]);

  // ── 状态图标 ──

  const stateIcon = (state: string) => {
    switch (state) {
      case 'NORMAL': return <CheckCircle2 className="w-5 h-5 text-green-400" />;
      case 'DEGRADED': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'CRITICAL': return <XCircle className="w-5 h-5 text-red-400" />;
      case 'OVERLOAD': return <Zap className="w-5 h-5 text-orange-400" />;
      case 'IDLE': return <Activity className="w-5 h-5 text-blue-400" />;
      default: return <Activity className="w-5 h-5 text-gray-400" />;
    }
  };

  const tri = triData;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-100">TRI-State 仪表盘</h2>
              <p className="text-sm text-gray-500">活跃度 × 命中率 × 健康度</p>
            </div>
          </div>
          <button
            onClick={loadTri}
            disabled={loading}
            className="px-3 py-1.5 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors text-sm text-gray-300 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            无法加载 TRI 数据: {error}（后端可能未运行）
          </div>
        )}

        {tri && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* 系统状态卡片 */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg">
              <div className="p-4 border-b border-gray-700 flex items-center gap-2">
                <Heart className="w-5 h-5 text-gray-400" />
                <h3 className="font-medium text-gray-100">系统状态</h3>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-center gap-4 mb-6">
                  {stateIcon(tri.state)}
                  <span className={`text-2xl font-bold ${triStateColor(tri.state)}`}>
                    {tri.state}
                  </span>
                </div>

                {/* 三维进度条 */}
                <div className="space-y-4">
                  <DimBar label="活跃度 (Activity)" value={tri.A} color="bg-blue-500" />
                  <DimBar label="命中率 (Success)" value={tri.S} color="bg-purple-500" />
                  <DimBar label="健康度 (Health)" value={tri.H} color="bg-green-500" />
                </div>

                {/* TRI Score + Health Ratio */}
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="bg-gray-900/50 rounded-lg p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">TRI Score</div>
                    <div className={`text-2xl font-bold font-mono ${triStateColor(tri.state)}`}>
                      {formatScore(tri.triScore)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">理想值 0.125</div>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-4 text-center">
                    <div className="text-xs text-gray-500 mb-1">Health Ratio</div>
                    <div className="text-2xl font-bold font-mono text-teal-400">
                      {formatPct(tri.healthRatio)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">自动调整范围 10–20%</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 手动更新面板 */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg">
              <div className="p-4 border-b border-gray-700 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-gray-400" />
                <h3 className="font-medium text-gray-100">手动更新三维状态</h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">A (活跃度) 0.0–1.0</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={editA}
                      onChange={(e) => setEditA(e.target.value)}
                      placeholder={tri.A.toFixed(1)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 placeholder-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">S (命中率) 0.0–1.0</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={editS}
                      onChange={(e) => setEditS(e.target.value)}
                      placeholder={tri.S.toFixed(1)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 placeholder-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">H (健康度) 0.0–1.0</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={editH}
                      onChange={(e) => setEditH(e.target.value)}
                      placeholder={tri.H.toFixed(1)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 placeholder-gray-600"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {updateMsg && (
                    <span className={`text-xs ${updateMsg.includes('失败') ? 'text-red-400' : 'text-green-400'}`}>
                      {updateMsg}
                    </span>
                  )}
                  <button
                    onClick={handleUpdate}
                    disabled={updating || (!editA && !editS && !editH)}
                    className="ml-auto px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                  >
                    {updating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
                    更新
                  </button>
                </div>
              </div>
            </div>

            {/* 历史快照 */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg">
              <div className="p-4 border-b border-gray-700 flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-400" />
                <h3 className="font-medium text-gray-100">历史快照</h3>
                <span className="text-xs text-gray-600 ml-auto">
                  {tri.history.length} 条记录
                </span>
              </div>
              {tri.history.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  暂无历史记录
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-500">
                        <th className="text-left px-4 py-3 font-medium">时间</th>
                        <th className="text-right px-4 py-3 font-medium">A</th>
                        <th className="text-right px-4 py-3 font-medium">S</th>
                        <th className="text-right px-4 py-3 font-medium">H</th>
                        <th className="text-right px-4 py-3 font-medium">Score</th>
                        <th className="text-center px-4 py-3 font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...tri.history].reverse().map((snap, i) => (
                        <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50 text-gray-300">
                          <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">
                            {new Date(snap.timestamp).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">{snap.A.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{snap.S.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{snap.H.toFixed(3)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{snap.triScore.toFixed(4)}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${triStateColor(snap.state)}`}>
                              {snap.state}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
