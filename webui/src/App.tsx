/**
 * mainfold-agent WebUI — App 壳
 *
 * 基于 Hermes App.tsx 骨架改写：
 *   - 标题 → Mainfold Agent
 *   - health 接口 → 对齐新 /api/health（tri/heartbeat/identity/eb006）
 *   - 侧边栏 5 页：TRI / Chat / Memory / Security / Settings
 */

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Brain,
  Shield,
  Settings,
  Activity,
  Zap,
  Heart,
  BarChart3,
} from 'lucide-react';
import ChatPage from './pages/ChatPage';
import MemoryPage from './pages/MemoryPage';
import SecurityPage from './pages/SecurityPage';
import SettingsPage from './pages/SettingsPage';
import TriPage from './pages/TriPage';

// ── Health 接口类型（对齐后端 /api/health）──

interface HealthData {
  services: {
    backend: string;
    deepseek_api: string;
  };
  tri: {
    A: number;
    S: number;
    H: number;
    triScore: number;
    state: string;
  };
  heartbeat: {
    status: string;
    lastBeat: number | null;
    misses: number;
  };
  identity: {
    loaded: boolean;
    source: string;
  };
}

// ── 页面路由 ──

type Page = 'tri' | 'chat' | 'memory' | 'security' | 'settings';

const NAV_ITEMS: { key: Page; icon: React.ReactNode; label: string }[] = [
  { key: 'tri', icon: <BarChart3 size={20} />, label: 'TRI' },
  { key: 'chat', icon: <MessageSquare size={20} />, label: 'Chat' },
  { key: 'memory', icon: <Brain size={20} />, label: 'Memory' },
  { key: 'security', icon: <Shield size={20} />, label: 'Security' },
  { key: 'settings', icon: <Settings size={20} />, label: 'Settings' },
];

// ── 版本信息接口 ──
interface VersionData {
  version: string;
  buildTime: string;
  nodeVersion: string;
  uptime: number;
}

// ── 前端版本（与后端 APP_VERSION 同步）──
const FRONTEND_VERSION = '1.0.0-mainfold';

export default function App() {
  const [page, setPage] = useState<Page>('chat');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionData | null>(null);
  const [versionMismatch, setVersionMismatch] = useState(false);

  // 健康轮询（15秒）
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setHealth(data);
        }
      } catch {
        // 后端未启动，静默
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, []);

  // 版本检查轮询（30秒）
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const data = await res.json();
          setVersionInfo(data);
          setVersionMismatch(data.version !== FRONTEND_VERSION);
        }
      } catch {
        // 后端未启动，静默
      }
    };
    checkVersion();
    const id = setInterval(checkVersion, 30000);
    return () => clearInterval(id);
  }, []);

  const triScore = health?.tri?.triScore ?? 0;
  const triState = health?.tri?.state ?? 'unknown';
  const heartbeatStatus = health?.heartbeat?.status ?? 'unknown';

  // TRI 颜色映射
  const triColor =
    triScore >= 0.7
      ? 'text-green-400'
      : triScore >= 0.4
        ? 'text-yellow-400'
        : 'text-red-400';

  const hbColor =
    heartbeatStatus === 'alive'
      ? 'text-green-400'
      : heartbeatStatus === 'degraded'
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* ── 侧边栏 ── */}
      <aside className="w-16 bg-gray-900 flex flex-col items-center py-4 border-r border-gray-800">
        {/* Logo */}
        <div className="mb-6 text-primary-400">
          <Zap size={24} />
        </div>

        {/* 导航 */}
        <nav className="flex-1 flex flex-col gap-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              className={`p-3 rounded-lg transition-colors ${
                page === item.key
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </nav>

        {/* 底部健康指标 */}
        <div className="mt-auto flex flex-col gap-2 items-center text-xs">
          <div className={`${triColor}`} title={`TRI Score: ${triScore.toFixed(2)} — ${triState}`}>
            <Activity size={16} />
          </div>
          <div className={`${hbColor}`} title={`Heartbeat: ${heartbeatStatus}`}>
            <Heart size={16} />
          </div>
        </div>
      </aside>

      {/* ── 主内容区 ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 justify-between shrink-0">
          <h1 className="text-sm font-semibold text-primary-300">
            Mainfold Agent — 流形导航 × MemPalace
          </h1>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {/* 版本不一致警告 */}
            {versionMismatch && (
              <span className="px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded border border-yellow-700" title={`前端: ${FRONTEND_VERSION} | 后端: ${versionInfo?.version}`}>
                ⚠️ 版本不一致 — 请重启后端
              </span>
            )}
            {health && (
              <>
                <span>
                  TRI{' '}
                  <span className={triColor}>
                    {triScore.toFixed(2)}
                  </span>
                </span>
                <span>·</span>
                <span>
                  A={health.tri.A} S={health.tri.S} H={health.tri.H}
                </span>
                <span>·</span>
                <span className={hbColor}>{heartbeatStatus}</span>
              </>
            )}
            {!health && (
              <span className="text-red-400">Backend Offline</span>
            )}
          </div>
        </header>

        {/* 页面内容 */}
        <div className="flex-1 overflow-hidden">
          {page === 'tri' && <TriPage />}
          {page === 'chat' && <ChatPage />}
          {page === 'memory' && <MemoryPage />}
          {page === 'security' && <SecurityPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}
