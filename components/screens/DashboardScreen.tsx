'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Bot, TrendingUp, Zap, AlertTriangle,
  ArrowRight, RefreshCw, Activity, Play,
  Square, CheckCircle2, XCircle, Clock,
  Database, MessageCircle, Cpu, Globe,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { StatCard } from '@/components/shared/StatCard';
import { LoadingState } from '@/components/shared/LoadingState';
import { EmptyState } from '@/components/shared/EmptyState';
import type { AutoBidSettings, AutoBidLog, Application, NavTab } from '@/types';

interface RealStats {
  sentTotal: number;
  sentToday: number;
  draftTotal: number;
  errorCount: number;
  successCount: number;
}
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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

interface DashboardScreenProps {
  onNavigate: (tab: NavTab) => void;
}

export function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const [settings, setSettings] = useState<AutoBidSettings | null>(null);
  const [recentLogs, setRecentLogs] = useState<AutoBidLog[]>([]);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [realStats, setRealStats] = useState<RealStats>({ sentTotal: 0, sentToday: 0, draftTotal: 0, errorCount: 0, successCount: 0 });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ submitted: number; skipped: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [appTab, setAppTab] = useState<'sent' | 'sent_unconfirmed' | 'skipped' | 'failed' | 'all'>('sent');
  const [appLoading, setAppLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, logsRes, statusRes, statsRes] = await Promise.all([
        fetch('/api/auto-bid/settings').then((r) => r.json()),
        fetch('/api/logs?limit=5').then((r) => r.json()),
        fetch('/api/status').then((r) => r.json()).catch(() => null),
        fetch('/api/stats').then((r) => r.json()).catch(() => null),
      ]);
      if (settingsRes.ok) setSettings(settingsRes.data);
      if (logsRes.ok) setRecentLogs(logsRes.data);
      if (statusRes) {
        // Always probe the local worker from the browser — process.env is server-only.
        // If the local worker responds it takes full priority over whatever the server reported
        // (server-side probes to localhost:8080 always fail when running on Vercel).
        const localWorker = await probeLocalWorker();
        if (localWorker) {
          statusRes.localWorkerDetected = true;
          statusRes.workerMode = true;
          statusRes.workerModeLabel = 'local';
          statusRes.checks.freelancehunt = {
            ...statusRes.checks.freelancehunt,
            ok: localWorker.connected,
            mode: 'local_worker',
            cookieCount: localWorker.cookieCount,
            sessionPath: localWorker.sessionPath,
            storageStateExists: localWorker.storageStateExists,
            sessionValid: localWorker.sessionValid,
            error: localWorker.connected
              ? undefined
              : localWorker.storageStateExists
                ? 'Freelancehunt session expired — reconnect required'
                : 'Local worker: storageState.json not found',
          };
          if (localWorker.autoLoop) statusRes.autoLoop = localWorker.autoLoop;
          // Merge real-time counters from local worker into stats
          if (localWorker.counters) {
            setRealStats((prev) => ({
              ...prev,
              sentTotal:    localWorker.counters?.bidsSubmitted ?? prev.sentTotal,
              sentToday:    localWorker.counters?.bidsSubmitted ?? prev.sentToday,
              errorCount:   localWorker.counters?.errors        ?? prev.errorCount,
              successCount: localWorker.counters?.bidsSubmitted ?? prev.successCount,
            }));
          }
        } else if (statusRes.workerMode && statusRes.checks?.freelancehunt?.ok) {
          // Fallback: fetch autoLoop from /api/freelancehunt/status for Railway mode
          try {
            const workerStatusRes = await fetch('/api/freelancehunt/status').then((r) => r.json()).catch(() => null);
            if (workerStatusRes?.ok && workerStatusRes.data?.autoLoop) {
              statusRes.autoLoop = workerStatusRes.data.autoLoop;
            }
          } catch { /* ignore */ }
        }
        setStatus(statusRes);
      }
      if (statsRes?.ok && statsRes.data) setRealStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadApplications = useCallback(async (tab: 'sent' | 'sent_unconfirmed' | 'skipped' | 'failed' | 'all') => {
    setAppLoading(true);
    try {
      const res = await fetch(`/api/applications?status=${tab}&limit=20`).then((r) => r.json()).catch(() => null);
      if (res?.ok && Array.isArray(res.data)) {
        setApplications(res.data);
      } else {
        setApplications([]);
      }
    } finally {
      setAppLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadApplications(appTab); }, [loadApplications, appTab]);

  const handleToggleAutoBid = async () => {
    if (!settings) return;
    haptic.medium();
    const next = !settings.enabled;
    const res = await fetch('/api/auto-bid/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then((r) => r.json());
    if (res.ok) setSettings(res.data);
  };

  const handleRunNow = async () => {
    haptic.medium();
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await fetch('/api/auto-bid/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      if (res.ok) {
  setRunResult({ submitted: res.data.bidsSubmitted, skipped: res.data.bidsSkipped });
  haptic.success();
  await loadData();
  await loadApplications(appTab);
      } else {
        setRunError(res.error ?? 'Unknown error');
        haptic.error();
      }
    } finally {
      setRunning(false);
    }
  };

  const handleEmergencyStop = async () => {
    haptic.error();
    // POST /api/auto-bid/stop delegates to worker when in worker mode,
    // otherwise sets emergencyStop flag in local DB settings.
    await fetch('/api/auto-bid/stop', { method: 'POST' });
    // Also update local settings state to reflect the stop
    await fetch('/api/auto-bid/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, emergencyStop: true }),
    }).then((r) => r.json()).then((r) => { if (r.ok) setSettings(r.data); });
  };

  const dailyPercent = settings
    ? Math.min(Math.round((realStats.sentToday / settings.dailyLimit) * 100), 100)
    : 0;

  return (
    <div className="flex flex-col pb-nav px-4 pt-4 fade-in gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-balance">Auto-Bid Dashboard</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            <p className="text-[11px] text-muted-foreground">Internal system — connected to main account</p>
          </div>
        </div>
        <button
          onClick={() => { haptic.light(); loadData(); }}
          disabled={loading}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Auto-bid status toggle */}
      <div className={cn(
        'glass-card p-4 rounded-2xl',
        settings?.enabled && !settings.emergencyStop && 'ring-1 ring-green-500/30',
        settings?.emergencyStop && 'ring-1 ring-red-500/40',
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot size={18} className={settings?.enabled && !settings.emergencyStop ? 'text-green-400' : 'text-muted-foreground'} />
            <span className="font-semibold text-sm">Auto-Bid</span>
            {settings?.emergencyStop && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">STOP</span>
            )}
          </div>
          <button
            onClick={handleToggleAutoBid}
            disabled={!settings}
            className={cn(
              'relative w-12 h-6 rounded-full transition-all duration-300',
              settings?.enabled && !settings.emergencyStop ? 'bg-green-500' : 'bg-secondary'
            )}
          >
            <span className={cn(
              'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300',
              settings?.enabled && !settings.emergencyStop ? 'left-6' : 'left-0.5'
            )} />
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Заявок сьогодні: {realStats.sentToday} / {settings?.dailyLimit ?? '—'}</span>
          <span>{dailyPercent}%</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${dailyPercent}%` }}
          />
        </div>

        {/* Worker mode label */}
        {status && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mb-2 px-0.5">
            <span className={cn(
              'w-1.5 h-1.5 rounded-full flex-shrink-0',
              status.checks.freelancehunt.ok ? 'bg-green-400'
                : status.localWorkerDetected ? 'bg-yellow-400'
                : 'bg-red-400'
            )} />
            <span className="text-[10px] font-semibold text-primary">
              {status.workerModeLabel === 'railway' ? 'Railway worker'
                : status.workerModeLabel === 'local' ? 'Local worker connected'
                : 'No worker'}
            </span>
            {status.checks.freelancehunt.ok ? (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-green-400 font-medium">Freelancehunt connected</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-muted-foreground">
                  storageState: {status.checks.freelancehunt.storageStateExists ? 'loaded' : 'missing'}
                </span>
                {status.checks.freelancehunt.cookieCount !== undefined && (
                  <>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground">{status.checks.freelancehunt.cookieCount} cookies</span>
                  </>
                )}
              </>
            ) : status.localWorkerDetected ? (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-yellow-400">
                  {status.checks.freelancehunt.storageStateExists
                    ? 'session expired — reconnect required'
                    : 'storageState not found'}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">· session not found</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleRunNow}
            disabled={running || !settings || !!settings.emergencyStop}
            className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-all active:scale-95 brand-glow"
          >
            {running ? (
              <><RefreshCw size={13} className="animate-spin" />Запуск...</>
            ) : (
              <><Play size={13} />Start worker</>
            )}
          </button>
          <button
            onClick={() => { haptic.light(); onNavigate('settings'); }}
            className="py-2 px-3 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold flex items-center gap-1 transition-all active:scale-95"
          >
            Налаштування
          </button>
          {settings?.enabled && (
            <button
              onClick={handleEmergencyStop}
              title="Аварійна зупинка"
              className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center transition-all active:scale-95 flex-shrink-0"
            >
              <Square size={14} />
            </button>
          )}
        </div>

        {runResult && (
          <div className="mt-2 text-xs text-center text-green-400 font-medium">
            Цикл завершено — відправлено: {runResult.submitted}, пропущено: {runResult.skipped}
          </div>
        )}
        {runError && (
          <div className="mt-2 text-xs text-red-400 font-medium text-center leading-snug">
            {runError}
          </div>
        )}
      </div>

      {loading ? <LoadingState rows={2} /> : (
        <>
          {/* Stats — only shown when DB is connected and has real data */}
          {status?.checks.database.ok ? (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Відправлено сьогодні" value={realStats.sentToday} icon={<Zap size={16} />} accent />
              <StatCard label="Всього відправлено" value={realStats.sentTotal} icon={<TrendingUp size={16} />} />
              <StatCard label="Успішних (24h)" value={realStats.successCount} icon={<CheckCircle2 size={16} />} />
              <StatCard label="Помилок (24h)" value={realStats.errorCount} icon={<Activity size={16} />} sublabel="за 24 год" />
            </div>
          ) : (
            <EmptyState
              icon={<Activity size={22} />}
              title="Не підключено"
              description="Статистика доступна після підключення бази даних"
            />
          )}

          {/* Freelancehunt session status — always shown */}
          {status && (
            <div className={cn(
              'glass-card rounded-2xl p-3 border',
              status.checks.freelancehunt.ok
                ? 'border-green-500/20 bg-green-500/5'
                : status.checks.freelancehunt.storageStateExists
                  ? 'border-yellow-500/20 bg-yellow-500/5'
                  : 'border-border/50'
            )}>
              <div className="flex items-center gap-3">
                <span className={cn(
                  'w-2.5 h-2.5 rounded-full flex-shrink-0',
                  status.checks.freelancehunt.ok ? 'bg-green-400'
                    : status.checks.freelancehunt.storageStateExists ? 'bg-yellow-400'
                    : 'bg-muted-foreground'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">
                    {status.checks.freelancehunt.ok
                      ? 'Freelancehunt Connected'
                      : status.checks.freelancehunt.storageStateExists
                        ? 'Freelancehunt session expired'
                        : 'Freelancehunt session not found'}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {status.checks.freelancehunt.ok
                      ? `storageState loaded · ${status.checks.freelancehunt.cookieCount ?? 0} cookies`
                      : (status.checks.freelancehunt.error ?? 'Run: npm run login:freelancehunt')}
                  </p>
                </div>
                {status.checks.freelancehunt.ok && (
                  <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                )}
              </div>
              {/* Auto-loop status row */}
              {status.autoLoop && (
                <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      status.autoLoop.enabled ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'
                    )} />
                    <span className="text-[11px] text-muted-foreground">
                      Auto-loop {status.autoLoop.enabled ? `running (every ${status.autoLoop.intervalMs / 1000}s)` : 'stopped'}
                    </span>
                  </div>
                  {status.autoLoop.lastCheckedAt && (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {formatDistanceToNow(new Date(status.autoLoop.lastCheckedAt), { addSuffix: true, locale: uk })}
                    </span>
                  )}
                </div>
              )}
              {status.autoLoop?.lastError && (
                <p className="text-[11px] text-red-400 mt-1.5 leading-snug">{status.autoLoop.lastError}</p>
              )}
              {/* Navigate to account page */}
              {!status.checks.freelancehunt.ok && (
                <button
                  onClick={() => { haptic.light(); onNavigate('profile'); }}
                  className="mt-2 text-[11px] text-primary font-medium flex items-center gap-1"
                >
                  Connect account <ArrowRight size={10} />
                </button>
              )}
            </div>
          )}

          {/* Setup instructions — only shown when no session and no worker URL */}
          {status && !status.workerMode && !status.checks.freelancehunt.ok && (
            <div className="glass-card rounded-2xl p-4 border border-yellow-500/20 bg-yellow-500/5">
              <p className="text-xs font-semibold text-yellow-400 mb-2">Automation worker not configured</p>
              <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                Bids are submitted via Playwright browser automation (the Freelancehunt REST API for bid submission was removed). A saved session is required.
              </p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">1</span>
                  <p className="text-[11px] text-muted-foreground">Save your Freelancehunt session (run once locally):<br />
                    <code className="font-mono text-foreground">npm run login:freelancehunt</code>
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">2</span>
                  <p className="text-[11px] text-muted-foreground">Copy <code className="font-mono text-foreground">storageState.json</code> to the Railway deployment root (or set <code className="font-mono text-foreground">FREELANCEHUNT_SESSION_PATH</code>).</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">3</span>
                  <p className="text-[11px] text-muted-foreground">Start the worker:<br />
                    <code className="font-mono text-foreground">npm run worker:start</code>
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">4</span>
                  <p className="text-[11px] text-muted-foreground">Set in Vercel env vars:<br />
                    <code className="font-mono text-foreground">AUTOMATION_WORKER_URL=http://YOUR_IP:3001</code><br />
                    <code className="font-mono text-foreground">AUTOMATION_SECRET=your-secret</code>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Integration status */}
          {status && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Integrations</h2>
              <div className="glass-card rounded-2xl overflow-hidden divide-y divide-border">
                {([
                  { key: 'openai',        label: 'OpenAI',        icon: Cpu,           sub: status.checks.openai.model },
                  { key: 'telegram',      label: 'Telegram',      icon: MessageCircle, sub: status.checks.telegram.chatId ? `chat ${status.checks.telegram.chatId}` : undefined },
                  { key: 'database',      label: 'Database',      icon: Database,      sub: status.checks.database.backend },
                  {
                    key: 'freelancehunt',
                    label: status.workerModeLabel === 'local'
                      ? 'Freelancehunt (local worker)'
                      : status.workerModeLabel === 'railway'
                        ? 'Freelancehunt (Railway worker)'
                        : 'Freelancehunt',
                    icon: Globe,
                    sub: status.checks.freelancehunt.ok
                      ? `storageState loaded · ${status.checks.freelancehunt.cookieCount ?? 0} cookies`
                      : (status.checks.freelancehunt.error ?? 'session not found'),
                  },
                ] as const).map(({ key, label, icon: Icon, sub }) => {
                  const check = status.checks[key as keyof typeof status.checks];
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2.5">
                      <Icon size={14} className="text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{label}</p>
                        {(sub || check.error) && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {check.error ?? sub}
                          </p>
                        )}
                      </div>
                      <span className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        check.ok ? 'bg-green-400' : 'bg-red-400'
                      )} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent logs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Останні дії</h2>
              <button
                onClick={() => { haptic.light(); onNavigate('logs'); }}
                className="text-xs text-primary font-medium flex items-center gap-1"
              >
                Всі логи <ArrowRight size={12} />
              </button>
            </div>
            {recentLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">Немає даних</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {recentLogs.slice(0, 5).map((log) => {
                  const Icon = LOG_ICONS[log.level] ?? Clock;
                  return (
                    <div key={log.id} className="glass-card px-3 py-2.5 rounded-xl flex items-start gap-2.5">
                      <Icon size={13} className={cn('mt-0.5 flex-shrink-0', LOG_COLORS[log.level])} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs leading-snug truncate">{log.message}</p>
                        {log.projectTitle && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{log.projectTitle}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true, locale: uk })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent applications — real worker output only, no mock data */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Останні заявки</h2>
              <button
                onClick={() => { haptic.light(); onNavigate('history'); }}
                className="text-xs text-primary font-medium flex items-center gap-1"
              >
                Всі <ArrowRight size={12} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 mb-2">
              {([
                ['sent',             'Відправлені'],
                ['sent_unconfirmed', 'Непідтверджені'],
                ['skipped',          'Пропущені'],
                ['failed',           'Помилки'],
                ['all',              'Всі'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => { haptic.light(); setAppTab(tab); }}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
                    appTab === tab
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {appLoading ? (
              <div className="flex items-center justify-center py-6">
                <RefreshCw size={14} className="animate-spin text-muted-foreground" />
              </div>
            ) : applications.length === 0 ? (
              <div className="glass-card rounded-2xl p-4 text-center">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {appTab === 'sent'             ? 'Ще немає відправлених заявок. Запустіть worker або зачекайте нові релевантні проєкти.' :
                   appTab === 'sent_unconfirmed' ? 'Немає непідтверджених заявок.' :
                   appTab === 'skipped'          ? 'Немає пропущених проєктів.' :
                   appTab === 'failed'           ? 'Немає помилок — все добре.' :
                                                  'Немає заявок. Запустіть worker для обробки проєктів.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {applications.map((app) => (
                  <div key={app.id} className="glass-card p-3 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                        app.status === 'sent'             ? 'bg-green-500/15' :
                        app.status === 'sent_unconfirmed' ? 'bg-blue-500/15' :
                        app.status === 'skipped'          ? 'bg-yellow-500/15' :
                                                            'bg-red-500/15'
                      )}>
                        {app.status === 'sent'             ? <CheckCircle2 size={13} className="text-green-400" /> :
                         app.status === 'sent_unconfirmed' ? <CheckCircle2 size={13} className="text-blue-400" /> :
                         app.status === 'skipped'          ? <Clock size={13} className="text-yellow-400" /> :
                                                             <XCircle size={13} className="text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{app.title}</p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-[11px] text-muted-foreground">
                            {app.budget} {app.currency}
                          </span>
                          {app.deadline && (
                            <span className="text-[11px] text-muted-foreground">· {app.deadline}</span>
                          )}
                          {app.aiScore !== undefined && (
                            <span className="text-[11px] text-muted-foreground">· AI {app.aiScore}%</span>
                          )}
                        </div>
                        {(app.status === 'skipped' || app.status === 'failed') && app.skippedReason && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5 opacity-70">
                            {app.skippedReason.length > 70
                              ? app.skippedReason.slice(0, 70) + '…'
                              : app.skippedReason}
                          </p>
                        )}
                        {app.status === 'sent_unconfirmed' && (
                          <p className="text-[10px] text-blue-400/70 mt-0.5">
                            Відправлено, підтвердження не отримано
                          </p>
                        )}
                        {app.matchedKeywords && app.matchedKeywords.length > 0 && (
                          <p className="text-[10px] text-primary/60 truncate mt-0.5">
                            {app.matchedKeywords.slice(0, 3).join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={cn(
                          'text-[10px] font-semibold',
                          app.status === 'sent'             ? 'text-green-400' :
                          app.status === 'sent_unconfirmed' ? 'text-blue-400' :
                          app.status === 'skipped'          ? 'text-yellow-400' :
                                                              'text-red-400'
                        )}>
                          {app.status === 'sent'             ? 'Відправлено' :
                           app.status === 'sent_unconfirmed' ? 'Надіслано?' :
                           app.status === 'skipped'          ? 'Пропущено' :
                                                               'Помилка'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(app.sentAt ?? app.createdAt), { addSuffix: true, locale: uk })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
