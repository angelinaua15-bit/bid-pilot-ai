'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Wifi, WifiOff, RefreshCw, CheckCircle2, ChevronRight,
  Sparkles, Send, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { SaaSUser, NavTab } from '@/types';

interface DashboardScreenProps {
  user: SaaSUser | null;
  onNavigate: (tab: NavTab) => void;
}

interface ExtStats {
  bidsTotal: number;
  bidsToday: number;
  filled: number;
  aiShare: number;
  lastActive: string | null;
  connected: boolean;
}
interface RecentBid {
  title: string | null; amount: number | null; days: number | null;
  ai: boolean; status: string | null; at: string;
}

export function DashboardScreen({ user, onNavigate }: DashboardScreenProps) {
  const [stats, setStats] = useState<ExtStats | null>(null);
  const [recent, setRecent] = useState<RecentBid[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = user?.id;

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const r = await fetch(`/api/freelancehunt/extension-stats?userId=${userId}`).then((x) => x.json()).catch(() => null);
      if (r?.ok) { setStats(r.stats); setRecent(r.recent || []); }
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const connected = !!stats?.connected;
  const fmtTime = (s?: string | null) =>
    s ? new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  const metrics = [
    { label: 'Подано сьогодні', value: stats?.bidsToday ?? 0 },
    { label: 'Подано всього', value: stats?.bidsTotal ?? 0 },
    { label: 'Заповнено форм', value: stats?.filled ?? 0 },
    { label: 'Частка AI', value: (stats?.aiShare ?? 0) + '%' },
  ];

  return (
    <div className="px-4 pt-5 pb-28 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">BidPilot</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {user ? `${user.name} · план ${user.subscriptionPlan}` : 'Завантаження...'}
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); load(); }}
          className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Extension status → tap to manage in Freelance tab */}
      <button
        onClick={() => { haptic.light(); onNavigate('freelance'); }}
        className={cn('w-full p-4 rounded-2xl border flex items-center gap-3 text-left active:scale-[0.99] transition-all',
          connected ? 'bg-green-500/10 border-green-500/20' : 'bg-secondary border-border')}
      >
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', connected ? 'bg-green-500/20' : 'bg-secondary')}>
          {connected ? <Wifi size={18} className="text-green-400" /> : <WifiOff size={18} className="text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{connected ? 'Розширення активне' : 'Підключити розширення'}</p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {connected ? `Остання активність: ${fmtTime(stats?.lastActive)}` : 'Встановіть BidPilot у Chrome, щоб подавати заявки автоматично'}
          </p>
        </div>
        <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
      </button>

      {/* Analytics */}
      <div className="grid grid-cols-2 gap-2.5">
        {metrics.map(({ label, value }) => (
          <div key={label} className="rounded-2xl bg-secondary border border-border p-4">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Recent bids */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Send size={14} className="text-primary" />
          <p className="text-sm font-semibold">Останні заявки</p>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-xs text-muted-foreground">
              {connected ? 'Ще немає поданих заявок. Увімкніть «Автоподача» у розширенні.' : 'Підключіть розширення — і заявки з\u2019являться тут.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recent.map((r: RecentBid, i: number) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-3 flex items-center gap-2.5">
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0',
                  r.status === 'submitted' ? 'bg-green-400' : r.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400')} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{r.title || 'Проєкт'}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Clock size={10} /> {fmtTime(r.at)}
                    {r.days ? ` · ${r.days} дн` : ''}
                  </p>
                </div>
                {r.amount ? <span className="text-[11px] text-muted-foreground flex-shrink-0">{r.amount} грн</span> : null}
                {r.ai ? <span className="text-[10px] text-primary font-semibold flex items-center gap-0.5 flex-shrink-0"><Sparkles size={10} />AI</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-semibold mb-2">Як це працює</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Розширення BidPilot у вашому Chrome переглядає стрічку Freelancehunt, AI пише індивідуальну заявку, ставить ціну й термін і подає її. Уся статистика — тут і у вкладці «Фрілансхант».
        </p>
      </div>
    </div>
  );
}