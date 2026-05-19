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
import type { AutoBidSettings, AutoBidLog, GeneratedBid, NavTab } from '@/types';

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
}
interface StatusData {
  ok: boolean;
  configured: Record<string, boolean>;
  workerMode: boolean;
  checks: {
    openai:        IntegrationCheck;
    telegram:      IntegrationCheck;
    database:      IntegrationCheck;
    freelancehunt: IntegrationCheck;
  };
  timestamp: string;
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
  const [recentBids, setRecentBids] = useState<GeneratedBid[]>([]);
  const [recentLogs, setRecentLogs] = useState<AutoBidLog[]>([]);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [realStats, setRealStats] = useState<RealStats>({ sentTotal: 0, sentToday: 0, draftTotal: 0, errorCount: 0, successCount: 0 });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ submitted: number; skipped: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, logsRes, bidsRes, statusRes, statsRes] = await Promise.all([
        fetch('/api/auto-bid/settings').then((r) => r.json()),
        fetch('/api/logs?limit=5').then((r) => r.json()),
        fetch('/api/history?limit=3').then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/status').then((r) => r.json()).catch(() => null),
        fetch('/api/stats').then((r) => r.json()).catch(() => null),
      ]);
      if (settingsRes.ok) setSettings(settingsRes.data);
      if (logsRes.ok) setRecentLogs(logsRes.data);
      if (bidsRes.ok && bidsRes.data) setRecentBids(bidsRes.data);
      if (statusRes) setStatus(statusRes);
      if (statsRes?.ok && statsRes.data) setRealStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

        <div className="flex gap-2">
          <button
            onClick={handleRunNow}
            disabled={running || !settings || !!settings.emergencyStop || !status?.workerMode}
            className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-all active:scale-95 brand-glow"
          >
            {running ? (
              <><RefreshCw size={13} className="animate-spin" />Запуск...</>
            ) : (
              <><Play size={13} />Запустити зараз</>
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

          {/* Worker connected */}
          {status?.workerMode && (
            <div className={cn(
              'glass-card rounded-2xl p-3 border flex items-center gap-3',
              status.checks.freelancehunt.ok
                ? 'border-green-500/20 bg-green-500/5'
                : 'border-red-500/20 bg-red-500/5'
            )}>
              <span className={cn(
                'w-2.5 h-2.5 rounded-full flex-shrink-0',
                status.checks.freelancehunt.ok ? 'bg-green-400' : 'bg-red-400'
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">
                  Worker {status.checks.freelancehunt.ok ? 'Connected' : 'Disconnected'}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {status.checks.freelancehunt.ok
                    ? `${status.checks.freelancehunt.username ?? 'authenticated'} · ${status.checks.freelancehunt.cookieCount ?? 0} cookies`
                    : (status.checks.freelancehunt.error ?? 'Worker unreachable')}
                </p>
              </div>
              {status.checks.freelancehunt.ok && (
                <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
              )}
            </div>
          )}

          {/* Worker not configured — setup instructions */}
          {status && !status.workerMode && (
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
                    label: status.workerMode ? 'Freelancehunt (worker)' : 'Freelancehunt',
                    icon: Globe,
                    sub: status.checks.freelancehunt.ok
                      ? `${status.checks.freelancehunt.username ?? 'connected'} · ${status.checks.freelancehunt.cookieCount ?? 0} cookies`
                      : status.workerMode
                        ? (status.checks.freelancehunt.error ?? 'Worker not connected')
                        : (status.checks.freelancehunt.checkedPaths?.length
                            ? `Not found — checked ${status.checks.freelancehunt.checkedPaths.length} paths`
                            : status.checks.freelancehunt.error ?? 'session not found'),
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

          {/* Recent bids */}
          {recentBids.length > 0 && (
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
              <div className="flex flex-col gap-2">
                {recentBids.map((bid) => (
                  <div key={bid.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <Zap size={14} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{bid.projectTitle}</p>
                      <p className="text-[11px] text-muted-foreground">${bid.price} · {bid.deadline}</p>
                    </div>
                    <span className={cn('text-[11px] font-medium flex-shrink-0',
                      bid.status === 'sent' ? 'text-blue-400' :
                      bid.status === 'replied' ? 'text-green-400' : 'text-muted-foreground'
                    )}>
                      {bid.status === 'sent' ? 'Відправлено' : bid.status === 'replied' ? 'Відповідь' : 'Чернетка'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
