'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, AlertTriangle, RefreshCw,
  Send, SkipForward, Play, Square, Wifi, WifiOff,
  Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import type { SaaSUser, SaaSDashboardStats, FreelanceAccount, Application, NavTab } from '@/types';
import { haptic } from '@/lib/telegram';

// ── Minimal toast ─────────────────────────────────────────────────────────────
let _toastTimer: ReturnType<typeof setTimeout> | null = null;
function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const show = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}




import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { cn, isOwner } from '@/lib/utils';

// ── Account status badge ──────────────────────────────────────────────────────
function AccountStatusBadge({ status }: { status: FreelanceAccount['status'] | null }) {
  if (!status) return <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><WifiOff size={11} /> Не підключено</span>;
  const map = {
    connected:    { cls: 'text-green-400',  Icon: Wifi,    label: 'Підключено' },
    disconnected: { cls: 'text-muted-foreground', Icon: WifiOff, label: 'Відключено' },
    expired:      { cls: 'text-yellow-400', Icon: WifiOff, label: 'Сесія закінчилась' },
    error:        { cls: 'text-red-400',    Icon: WifiOff, label: 'Помилка' },
  } as const;
  const { cls, Icon, label } = map[status] ?? map.disconnected;
  return <span className={cn('flex items-center gap-1 text-[11px] font-medium', cls)}><Icon size={11} /> {label}</span>;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="glass-card p-3 rounded-xl flex flex-col gap-1.5">
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', color)}><Icon size={13} /></div>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface DashboardScreenProps {
  user: SaaSUser | null;
  onNavigate: (tab: NavTab) => void;
}

interface IntegrationCheck {
  ok: boolean;
  username?: string;
  model?: string;
  mode?: string;
  error?: string;
  chatId?: number | null;
  backend?: string;
  sessionPath?: string;
  checkedPaths?: string[];
  cookieCount?: number;
  storageStateExists?: boolean;
  sessionValid?: boolean;
}
interface AutoLoopStatus {
  enabled: boolean;
  intervalMs: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface StatusData {
  ok: boolean;
  configured: Record<string, boolean>;
  workerMode: boolean;
  /** 'railway' | 'local' | 'none' */
  workerModeLabel?: string;
  localWorkerDetected?: boolean;
  autoLoop?: AutoLoopStatus;
  checks: {
    openai:        IntegrationCheck;
    telegram:      IntegrationCheck;
    database:      IntegrationCheck;
    freelancehunt: IntegrationCheck & { storageStateExists?: boolean };
  };
  timestamp: string;
}

const LOCAL_WORKER_URL = 'http://localhost:8080';

interface LocalWorkerStatus {
  connected: boolean;
  cookieCount?: number;
  sessionPath?: string;
  storageStateExists: boolean;
  sessionValid: boolean;
  autoLoop?: AutoLoopStatus;
  counters?: { bidsSubmitted?: number; bidsSkipped?: number; errors?: number; cycles?: number };
}

/** Try to reach the local worker directly from the browser. Returns null if unreachable. */
async function probeLocalWorker(): Promise<LocalWorkerStatus | null> {
  try {
    const res = await fetch(`${LOCAL_WORKER_URL}/status`, { signal: AbortSignal.timeout(3_500) });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const fh = (data.freelancehunt ?? {}) as Record<string, unknown>;
    const storageStateExists = Boolean(fh.connected) || Boolean(fh.sessionPath);
    // session is valid if connected=true AND cookieCount>0
    const sessionValid = Boolean(fh.connected) && (Number(fh.cookieCount ?? 0) > 0);
    return {
      connected: Boolean(fh.connected),
      cookieCount: fh.cookieCount as number | undefined,
      sessionPath: fh.sessionPath as string | undefined,
      storageStateExists,
      sessionValid,
      autoLoop: data.autoLoop as AutoLoopStatus | undefined,
      counters: data.counters as LocalWorkerStatus['counters'] | undefined,
    };
  } catch {
    return null;
  }
}

const LOG_COLORS: Record<string, string> = {
  info:    'text-muted-foreground',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error:   'text-red-400',
};
const LOG_ICONS: Record<string, React.ElementType> = {
  info:    Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  error:   XCircle,
};

export function DashboardScreen({ user, onNavigate }: DashboardScreenProps) {
  const [stats, setStats]     = useState<SaaSDashboardStats | null>(null);
  const [account, setAccount] = useState<FreelanceAccount | null>(null);
  const [apps, setApps]       = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(true);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [appTab, setAppTab]   = useState<Application['status'] | 'all'>('sent');
  const { toast, show: showToast } = useToast();
  const userId = user?.id;

  const loadStats = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/dashboard?userId=${userId}`).then((r) => r.json()).catch(() => null);
      if (res?.ok) { setStats(res.stats); setAccount(res.account ?? null); }
    } finally { setLoading(false); }
  }, [userId]);

  const loadApps = useCallback(async (status: typeof appTab) => {
    if (!userId) { setAppLoading(false); return; }
    setAppLoading(true);
    try {
      const res = await fetch(`/api/applications?userId=${userId}&status=${status}&limit=20`).then((r) => r.json()).catch(() => null);
      setApps(res?.ok && Array.isArray(res.data) ? res.data : []);
    } finally { setAppLoading(false); }
  }, [userId]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadApps(appTab); }, [loadApps, appTab]);

  const handleToggleWorker = async () => {
    if (!userId) return;
    const isRunning = stats?.isWorkerRunning ?? false;
    console.log('[DashboardScreen] handleToggleWorker clicked, isRunning:', isRunning, 'userId:', userId);

    haptic.medium();
    setWorkerBusy(true);

    // Optimistic update so UI responds immediately
    setStats((prev) => prev ? { ...prev, isWorkerRunning: !isRunning } : prev);

    try {
      const endpoint = isRunning ? '/api/freelance/stop' : '/api/freelance/start';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }).then((r) => r.json()).catch((err) => {
        console.error('[DashboardScreen] fetch error:', err);
        return null;
      });

      console.log('[DashboardScreen] API response:', res);

      if (res?.ok) {
        haptic.success();
        showToast(
          isRunning ? 'Автоматизацію зупинено' : 'Автоматизацію запущено',
          'success',
        );
        // Refresh from server to confirm saved state
        await loadStats();
      } else {
        haptic.error();
        const errMsg = res?.error ?? 'Невідома помилка';
        console.error('[DashboardScreen] toggle failed:', errMsg);
        showToast(`Помилка: ${errMsg}`, 'error');
        // Revert optimistic update
        setStats((prev) => prev ? { ...prev, isWorkerRunning: isRunning } : prev);
      }
    } catch (err) {
      haptic.error();
      console.error('[DashboardScreen] unexpected error:', err);
      showToast('Помилка запиту. Спробуйте ще раз.', 'error');
      setStats((prev) => prev ? { ...prev, isWorkerRunning: isRunning } : prev);
    } finally {
      setWorkerBusy(false);
    }
  };

  const tabs: Array<{ id: typeof appTab; label: string }> = [
    { id: 'sent', label: 'Надіслані' },
    { id: 'sent_unconfirmed', label: 'Непідтверджені' },
    { id: 'skipped', label: 'Пропущені' },
    { id: 'failed', label: 'Помилки' },
    { id: 'all', label: 'Всі' },
  ];

  return (
    <div className="px-4 pt-5 pb-28 flex flex-col gap-5">

      {/* Toast notification */}
      {toast && (
        <div className={cn(
          'fixed top-4 left-4 right-4 z-50 px-4 py-3 rounded-xl text-xs font-medium shadow-lg transition-all duration-300',
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        )}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">BidPilot</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user ? `${user.name} · п��ан ${user.subscriptionPlan}` : 'Завантаження...'}
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); loadStats(); loadApps(appTab); }}
          className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Account status + worker toggle */}
      <div className="glass-card p-4 rounded-2xl flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold">Freelancehunt</p>
          <AccountStatusBadge status={account?.status ?? null} />
          {account?.accountName && (
            <p className="text-[11px] text-muted-foreground">@{account.accountName}</p>
          )}
        </div>
        {account?.status === 'connected' ? (
          <button
            onClick={handleToggleWorker}
            disabled={workerBusy}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-60',
              stats?.isWorkerRunning
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : 'bg-green-500/15 text-green-400 border border-green-500/20'
            )}
          >
            {workerBusy ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : stats?.isWorkerRunning ? (
              <Square size={12} />
            ) : (
              <Play size={12} />
            )}
            {workerBusy
              ? (stats?.isWorkerRunning ? 'Зупиняємо...' : 'Запускаємо...')
              : stats?.isWorkerRunning ? 'Зупинити' : 'Запустити'}
          </button>
        ) : (
          <button
            onClick={() => { haptic.light(); onNavigate('freelance'); }}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary/15 text-primary border border-primary/20 active:scale-95 transition-transform"
          >
            Підключити
          </button>
        )}
      </div>

      {/* Stats grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card p-3 rounded-xl h-20 animate-pulse bg-secondary/30" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Надіслано всього" value={stats?.sentTotal ?? 0} icon={Send} color="bg-green-500/15 text-green-400" />
          <StatCard label="Сьогодні" value={stats?.sentToday ?? 0} icon={TrendingUp} color="bg-primary/15 text-primary" />
          <StatCard label="Пропущено" value={stats?.skipped ?? 0} icon={SkipForward} color="bg-secondary text-muted-foreground" />
          <StatCard label="Помилки" value={stats?.failed ?? 0} icon={AlertTriangle} color="bg-red-500/15 text-red-400" />
        </div>
      )}

      {/* Monthly quota */}
      {stats && (
        <div className="glass-card p-3 rounded-xl flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Ліміт цього місяця</span>
            {isOwner(user) ? (
              <span className="font-semibold text-green-400">Необмежено</span>
            ) : (
              <span className="font-semibold">{stats.applicationsThisMonth} / {stats.monthlyLimit}</span>
            )}
          </div>
          {!isOwner(user) && (
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (stats.applicationsThisMonth / stats.monthlyLimit) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Recent applications */}
      <div>
        <p className="text-xs font-semibold mb-2">Останні заявки</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { haptic.light(); setAppTab(id); }}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
                appTab === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {appLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw size={14} className="animate-spin text-muted-foreground" />
          </div>
        ) : apps.length === 0 ? (
          <div className="glass-card rounded-2xl p-5 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {appTab === 'sent' ? 'Ще немає надісланих заявок.' :
               appTab === 'sent_unconfirmed' ? 'Немає непідтверджених заявок.' :
               appTab === 'skipped' ? 'Немає пропущених проєктів.' :
               appTab === 'failed' ? 'Немає помилок — все добре.' :
               'Запустіть worker для обробки проєктів.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {apps.map((app) => (
              <AppRow key={app.id} app={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppRow({ app }: { app: Application }) {
  const statusColor = app.status === 'sent' ? 'text-green-400' :
    app.status === 'sent_unconfirmed' ? 'text-blue-400' :
    app.status === 'skipped' ? 'text-yellow-400' : 'text-red-400';
  const statusLabel = app.status === 'sent' ? 'Надіслано' :
    app.status === 'sent_unconfirmed' ? 'Надіслано?' :
    app.status === 'skipped' ? 'Пропущено' : 'Помилка';
  return (
    <div className="glass-card p-3 rounded-xl">
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{app.title}</p>
          <div className="flex flex-wrap gap-x-2 mt-0.5">
            <span className="text-[11px] text-muted-foreground">{app.budget} {app.currency}</span>
            {app.aiScore !== undefined && <span className="text-[11px] text-muted-foreground">· AI {app.aiScore}%</span>}
          </div>
          {app.skippedReason && (
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate opacity-70">{app.skippedReason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          <span className={cn('text-[10px] font-semibold', statusColor)}>{statusLabel}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(app.sentAt ?? app.createdAt), { addSuffix: true, locale: uk })}
          </span>
        </div>
      </div>
    </div>
  );
}
