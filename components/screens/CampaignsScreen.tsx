'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Send, CheckCircle2, XCircle, Clock,
  ChevronRight, Trash2, Play, Pause, Radio, Search, Smartphone,
  Users, AlertTriangle, BarChart2, Filter, Plus, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import { formatDistanceToNow, format } from 'date-fns';
import { uk } from 'date-fns/locale';
import type { SaaSUser, Campaign, TelegramChannel, CampaignMessage, TelegramAccount } from '@/types';
import { PLAN_LIMITS } from '@/types';

const PAGE_SIZE = 50;

interface Props { user: SaaSUser | null; }
type SubTab = 'channels' | 'campaigns' | 'create';

export function CampaignsScreen({ user }: Props) {
  const [subTab, setSubTab]       = useState<SubTab>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  // Total channel count shown in tab label — fetched cheaply
  const [channelTotal, setChannelTotal] = useState<number | null>(null);

  const userId = user?.id;
  const isPro  = user?.subscriptionPlan === 'pro' || user?.subscriptionPlan === 'agency' || user?.subscriptionPlan === 'unlimited' || user?.role === 'owner' || user?.role === 'admin';

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [cmpRes, countRes] = await Promise.all([
        fetch(`/api/campaigns?userId=${userId}`).then((r) => r.json()).catch(() => null),
        fetch('/api/channels?count=1').then((r) => r.json()).catch(() => null),
      ]);
      if (cmpRes?.ok)   setCampaigns(cmpRes.campaigns ?? []);
      if (countRes?.ok) setChannelTotal(countRes.total ?? null);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Free plan gate
  if (!isPro) {
    return (
      <div className="px-4 pt-5 pb-28 flex flex-col gap-5">
        <h1 className="text-lg font-bold">Кампанії</h1>
        <div className="glass-card p-6 rounded-2xl flex flex-col gap-3 items-center text-center border border-primary/20">
          <Radio size={32} className="text-primary/50" />
          <p className="text-sm font-semibold">Функція доступна у Pro та Agency</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Telegram-кампанії дозволяють розсилати повідомлення у авторизовані канали та групи.
            Оновіть план, щоб отримати доступ.
          </p>
          <span className="px-3 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold">
            Поточний план: {user?.subscriptionPlan ?? 'free'}
          </span>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: SubTab; label: string }> = [
    { id: 'campaigns', label: 'Кампанії' },
    { id: 'channels',  label: channelTotal !== null ? `Канали (${channelTotal.toLocaleString('uk-UA')})` : 'Канали' },
    { id: 'create',    label: '+ Нова' },
  ];

  return (
    <div className="px-4 pt-5 pb-28 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Кампанії</h1>
        <button onClick={() => { haptic.light(); load(); }}
          className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex rounded-xl bg-secondary p-0.5 gap-0.5">
        {tabs.map(({ id, label }) => (
          <button key={id} onClick={() => { haptic.light(); setSubTab(id); }}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all',
              subTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            )}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {subTab === 'campaigns' && <CampaignsList campaigns={campaigns} userId={userId} onRefresh={load} />}
          {subTab === 'channels'  && (
            <ChannelsList
              isAdmin={user?.role === 'admin' || user?.role === 'owner'}
              userId={userId}
              onTotalChange={setChannelTotal}
            />
          )}
          {subTab === 'create'    && (
            <CreateCampaignForm userId={userId} user={user} onCreated={() => { setSubTab('campaigns'); load(); }} />
          )}
        </>
      )}
    </div>
  );
}

// ── Campaigns list ────────────────────────────────────────────────────────────
function CampaignsList({ campaigns, userId, onRefresh }: {
  campaigns: Campaign[]; userId?: string; onRefresh: () => void;
}) {
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [messages, setMessages]         = useState<Record<string, CampaignMessage[]>>({});
  const [actionErr, setActionErr]       = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter]     = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}/logs`).then((r) => r.json()).catch(() => null);
    if (res?.ok) setMessages((m) => ({ ...m, [id]: res.messages ?? [] }));
  }, []);

  // Active statuses that require continuous polling
  const ACTIVE_STATUSES = new Set(['running', 'joining', 'sending']);

  // Auto-poll logs + parent list while any campaign is active
  useEffect(() => {
    const hasActive = campaigns.some((c) => ACTIVE_STATUSES.has(c.status));
    if (hasActive) {
      pollRef.current = setInterval(() => {
        campaigns.filter((c) => ACTIVE_STATUSES.has(c.status)).forEach((c) => {
          if (expanded === c.id) loadMessages(c.id);
        });
        onRefresh();
      }, 4000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, expanded, loadMessages, onRefresh]);

  const handleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id); loadMessages(id);
  };

  const handleAction = async (id: string, action: 'start' | 'pause') => {
    haptic.medium();
    setActionErr((e) => ({ ...e, [id]: '' }));
    const res = await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
    if (!res?.ok) {
      const msg = res?.error ?? 'Помилка запуску';
      setActionErr((e) => ({ ...e, [id]: msg }));
      haptic.error();
      return;
    }
    haptic.success();
    onRefresh();
  };

  if (campaigns.length === 0) {
    return (
      <div className="glass-card p-6 rounded-2xl text-center flex flex-col items-center gap-3">
        <Send size={28} className="text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">Немає кампаній. Створіть першу за допомогою вкладки &ldquo;+ Нова&rdquo;.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map((c) => {
        const STATUS_COLOR: Record<string, string> = {
          draft:               'text-muted-foreground',
          scheduled:           'text-blue-400',
          running:             'text-primary',
          joining:             'text-blue-400',
          sending:             'text-primary',
          paused:              'text-yellow-400',
          completed:           'text-green-400',
          partially_completed: 'text-yellow-400',
          failed:              'text-red-400',
          flood_wait:          'text-orange-400',
          no_accounts:         'text-red-400',
        };
        const STATUS_LABEL: Record<string, string> = {
          draft:               'Чернетка',
          scheduled:           'Запланована',
          running:             'Виконується',
          joining:             'Вступ до каналів',
          sending:             'Надсилання',
          paused:              'Призупинена',
          completed:           'Завершена',
          partially_completed: 'Частково завершена',
          failed:              'Помилка',
          flood_wait:          'FloodWait',
          no_accounts:         'Немає акаунтів',
        };
        const statusColor = STATUS_COLOR[c.status] ?? 'text-muted-foreground';
        const statusLabel = STATUS_LABEL[c.status] ?? c.status;
        const isActive    = ACTIVE_STATUSES.has(c.status);

        return (
          <div key={c.id} className="glass-card rounded-2xl overflow-hidden">
            <button onClick={() => handleExpand(c.id)} className="w-full p-4 flex items-start gap-3 text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold truncate">{c.title}</p>
                  <span className={cn('text-[10px] font-semibold flex-shrink-0', statusColor)}>{statusLabel}</span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{c.messageText}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-muted-foreground">{c.totalCount} каналів</span>
                  {c.sentCount > 0 && <span className="text-[10px] text-green-400">{c.sentCount} надіслано</span>}
                  {c.failedCount > 0 && <span className="text-[10px] text-red-400">{c.failedCount} помилок</span>}
                </div>
                {/* progress bar */}
                {c.totalCount > 0 && (isActive || c.status === 'completed' || c.status === 'partially_completed') && (
                  <div className="h-1 rounded-full bg-secondary mt-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((c.sentCount + c.failedCount) / c.totalCount) * 100)}%` }} />
                  </div>
                )}
              </div>
              <ChevronRight size={14} className={cn('text-muted-foreground flex-shrink-0 transition-transform', expanded === c.id && 'rotate-90')} />
            </button>

            {/* Expanded: stats + filters + message logs */}
            {expanded === c.id && (
              <div className="border-t border-border px-4 pb-4 pt-3 flex flex-col gap-3">
                {/* Action buttons */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    {(c.status === 'draft' || c.status === 'paused' || c.status === 'failed' ||
                      c.status === 'partially_completed' || c.status === 'flood_wait' || c.status === 'no_accounts') && (
                      <button onClick={() => handleAction(c.id, 'start')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-semibold active:scale-95 transition-all">
                        <Play size={11} /> Запустити
                      </button>
                    )}
                    {isActive && (
                      <button onClick={() => handleAction(c.id, 'pause')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-[11px] font-semibold active:scale-95 transition-all">
                        <Pause size={11} /> Пауза
                      </button>
                    )}
                  </div>
                  {actionErr[c.id] && (
                    <p className="text-[11px] text-red-400 bg-red-500/10 rounded-lg px-2.5 py-1.5">{actionErr[c.id]}</p>
                  )}
                </div>

                {/* Statistics grid */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BarChart2 size={11} className="text-muted-foreground" />
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Статистика</p>
                  </div>
                  {/* Primary counters */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Всього цілей',  value: c.totalCount,  color: 'text-foreground' },
                      { label: 'Надіслано',      value: c.sentCount,   color: 'text-green-400' },
                      { label: 'Помилок відпр.', value: c.failedCount, color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-secondary/50 rounded-xl px-2.5 py-2 text-center">
                        <p className={cn('text-sm font-bold', color)}>{value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                  {/* Detailed join/send breakdown from message logs */}
                  {(messages[c.id] ?? []).length > 0 && (() => {
                    const msgs        = messages[c.id]!;
                    const joined      = msgs.filter((m) => m.joinStatus === 'joined').length;
                    const failedJoin  = msgs.filter((m) => m.joinStatus === 'join_failed').length;
                    const waiting     = msgs.filter((m) => m.status === 'waiting_approval').length;
                    const invalid     = msgs.filter((m) => m.status === 'invalid_channel').length;
                    const skipped     = msgs.filter((m) => m.status === 'skipped').length;
                    const accs        = [...new Set(msgs.filter((m) => m.accountPhone).map((m) => m.accountPhone))];
                    const firstSent   = msgs.find((m) => m.sentAt)?.sentAt;
                    const lastSent    = [...msgs].reverse().find((m) => m.sentAt)?.sentAt;
                    return (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {/* Secondary counters */}
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { label: 'Вступів',       value: joined,     color: 'text-blue-400' },
                            { label: 'Помилок вступу',value: failedJoin, color: 'text-orange-400' },
                            { label: 'Пропущено',     value: skipped,    color: 'text-yellow-400' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="bg-secondary/30 rounded-lg px-2 py-1.5 text-center">
                              <p className={cn('text-xs font-bold', color)}>{value}</p>
                              <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
                            </div>
                          ))}
                        </div>
                        {(waiting > 0 || invalid > 0) && (
                          <div className="flex gap-3 flex-wrap">
                            {waiting > 0 && <span className="text-[10px] text-blue-400">{waiting} очікує підтв. адміна</span>}
                            {invalid > 0 && <span className="text-[10px] text-orange-400">{invalid} канал(ів) не знайдено</span>}
                          </div>
                        )}
                        {accs.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <Smartphone size={9} className="text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">{accs.join(', ')}</span>
                          </div>
                        )}
                        {firstSent && (
                          <p className="text-[10px] text-muted-foreground">
                            Початок: {format(new Date(firstSent), 'dd MMM yyyy HH:mm', { locale: uk })}
                            {lastSent && lastSent !== firstSent && ` — ${format(new Date(lastSent), 'HH:mm')}`}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Progress bar when active */}
                {isActive && c.totalCount > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-[10px] text-muted-foreground">Прогрес</span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(((c.sentCount + c.failedCount) / c.totalCount) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.min(100, ((c.sentCount + c.failedCount) / c.totalCount) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {/* Logs section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Filter size={10} className="text-muted-foreground" />
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Логи розсилки</p>
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-secondary rounded-md px-1.5 py-0.5 text-[10px] outline-none">
                        <option value="all">Всі</option>
                        <option value="sent">Надіслано</option>
                        <option value="failed">Помилка</option>
                        <option value="waiting_approval">Очікує</option>
                        <option value="invalid_channel">Не знайдено</option>
                        <option value="skipped">Пропущено</option>
                      </select>
                      <input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="bg-secondary rounded-md px-1.5 py-0.5 text-[10px] outline-none w-28"
                      />
                    </div>
                  </div>
                  {(messages[c.id] ?? []).length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">Немає логів розсилки</p>
                  ) : (() => {
                    const filtered = (messages[c.id] ?? []).filter((msg) => {
                      if (statusFilter !== 'all' && msg.status !== statusFilter) return false;
                      if (dateFilter && msg.sentAt) {
                        const d = new Date(msg.sentAt).toISOString().slice(0, 10);
                        if (d !== dateFilter) return false;
                      }
                      return true;
                    });
                    if (filtered.length === 0) return (
                      <p className="text-[11px] text-muted-foreground">Немає записів за фільтром</p>
                    );
                    return (
                      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                        {filtered.map((msg) => (
                          <div key={msg.id} className="flex flex-col gap-0.5 py-1 border-b border-border/30 last:border-0">
                            <div className="flex items-center gap-2">
                              {/* Send status icon */}
                              {msg.status === 'sent'             && <CheckCircle2 size={11} className="text-green-400 flex-shrink-0" />}
                              {msg.status === 'failed'           && <XCircle      size={11} className="text-red-400 flex-shrink-0" />}
                              {msg.status === 'pending'          && <Clock        size={11} className="text-muted-foreground flex-shrink-0" />}
                              {msg.status === 'skipped'          && <Clock        size={11} className="text-yellow-400 flex-shrink-0" />}
                              {msg.status === 'waiting_approval' && <Clock        size={11} className="text-blue-400 flex-shrink-0" />}
                              {msg.status === 'invalid_channel'  && <XCircle      size={11} className="text-orange-400 flex-shrink-0" />}

                              <span className="text-[11px] font-medium flex-1 truncate min-w-0">
                                {msg.channelTitle ?? msg.channelId}
                              </span>

                              {/* Join status badge */}
                              {msg.joinStatus === 'joined' && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 flex-shrink-0 whitespace-nowrap">вступ</span>
                              )}
                              {msg.joinStatus === 'already_member' && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground flex-shrink-0 whitespace-nowrap">вже учасник</span>
                              )}
                              {msg.joinStatus === 'approval_pending' && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 flex-shrink-0 whitespace-nowrap">очікує підтв.</span>
                              )}
                              {msg.joinStatus === 'join_failed' && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 flex-shrink-0 whitespace-nowrap">вступ не вдався</span>
                              )}

                              {/* Send status badge for non-sent */}
                              {msg.status === 'invalid_channel' && !msg.joinStatus && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 flex-shrink-0 whitespace-nowrap">не знайдено</span>
                              )}

                              {/* Time */}
                              {msg.sentAt && (
                                <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">
                                  {format(new Date(msg.sentAt), 'HH:mm', { locale: uk })}
                                </span>
                              )}
                            </div>
                            {/* Second line: account + error */}
                            {(msg.accountPhone || msg.errorReason || msg.telegramErrorCode) && (
                              <div className="flex items-center gap-2 pl-[18px]">
                                {msg.accountPhone && (
                                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 flex-shrink-0">
                                    <Smartphone size={8} />{msg.accountPhone}
                                  </span>
                                )}
                                {msg.telegramErrorCode && msg.status !== 'sent' && (
                                  <span className="text-[9px] font-mono text-muted-foreground/60 flex-shrink-0">{msg.telegramErrorCode}</span>
                                )}
                                {msg.errorReason && msg.status !== 'sent' && (
                                  <span className="text-[10px] text-red-400/80 truncate" title={msg.errorReason}>
                                    {msg.errorReason.slice(0, 55)}{msg.errorReason.length > 55 ? '…' : ''}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Channels list — server-side paginated with infinite scroll ─────────────────
function ChannelsList({ isAdmin, userId, onTotalChange }: {
  isAdmin: boolean; userId?: string; onTotalChange?: (n: number) => void;
}) {
  const [channels, setChannels]     = useState<TelegramChannel[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [hasMore, setHasMore]       = useState(true);
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ title: '', usernameOrLink: '', type: 'channel', language: 'uk', category: '' });
  const [saving, setSaving]         = useState(false);
  const [seeding, setSeeding]       = useState(false);
  const [seedMsg, setSeedMsg]       = useState<{ ok: boolean; text: string } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input — 400 ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Reset list when search or category changes
  useEffect(() => {
    setChannels([]);
    setPage(1);
    setHasMore(true);
  }, [debouncedSearch, filterCat]);

  // Load a page
  const loadPage = useCallback(async (pageNum: number) => {
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:     String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterCat)       params.set('category', filterCat);

      const res = await fetch(`/api/channels?${params}`).then((r) => r.json()).catch(() => null);
      if (!res?.ok) return;

      const incoming: TelegramChannel[] = res.channels ?? [];
      setChannels((prev) => pageNum === 1 ? incoming : [...prev, ...incoming]);
      setTotal(res.total ?? 0);
      setHasMore(res.hasMore ?? false);
      onTotalChange?.(res.total ?? 0);

      // Build category list from first load
      if (pageNum === 1 && !debouncedSearch && !filterCat) {
        const cats = Array.from(new Set(incoming.map((c) => c.category).filter(Boolean))) as string[];
        if (cats.length) setCategories((prev) => Array.from(new Set([...prev, ...cats])).sort());
      }
    } finally {
      setLoading(false);
    }
  }, [loading, debouncedSearch, filterCat, onTotalChange]);

  // Load whenever page changes
  useEffect(() => { loadPage(page); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, debouncedSearch, filterCat]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasMore && !loading) setPage((p) => p + 1); },
      { rootMargin: '200px' },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.usernameOrLink.trim()) return;
    haptic.medium(); setSaving(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => r.json());
      if (res.ok) {
        haptic.success();
        setShowForm(false);
        setForm({ title: '', usernameOrLink: '', type: 'channel', language: 'uk', category: '' });
        // Refresh
        setChannels([]); setPage(1); setHasMore(true);
      }
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    haptic.error();
    await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    setChannels((prev) => { const next = prev.filter((c) => c.id !== id); return next; });
    setTotal((t) => Math.max(0, t - 1));
    onTotalChange?.(Math.max(0, total - 1));
  };

  const handleSeed = async () => {
    haptic.medium(); setSeeding(true); setSeedMsg(null);
    try {
      const url = userId
        ? `/api/channels/seed?requesterId=${encodeURIComponent(userId)}`
        : '/api/channels/seed';
      const res = await fetch(url, { method: 'POST' }).then((r) => r.json());
      if (res.ok) {
        haptic.success();
        const parts: string[] = [`Завантажено ${(res.inserted ?? 0).toLocaleString('uk-UA')} каналів`];
        if (res.europeGroups)      parts.push(`${res.europeGroups} груп українців в Європі`);
        if (res.catalogueChannels) parts.push(`${res.catalogueChannels} з каталогу`);
        if (res.totalInDb)         parts.push(`Всього в базі: ${res.totalInDb.toLocaleString('uk-UA')}`);
        setSeedMsg({ ok: true, text: parts.join(' · ') });
        // Refresh list
        setChannels([]); setPage(1); setHasMore(true);
        onTotalChange?.(res.totalInDb ?? 0);
      } else {
        haptic.error();
        setSeedMsg({ ok: false, text: `Помилка: ${res.error ?? 'невідома'}` });
      }
    } finally { setSeeding(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Admin toolbar */}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/15 text-primary text-xs font-semibold self-start active:scale-95 transition-transform"
          >
            <Plus size={12} /> Додати канал
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/15 text-green-400 text-xs font-semibold self-start active:scale-95 transition-transform disabled:opacity-50"
          >
            <RefreshCw size={12} className={seeding ? 'animate-spin' : ''} />
            {seeding ? 'Імпорт...' : 'Завантажити 10k+ каналів'}
          </button>
        </div>
      )}

      {seedMsg && (
        <p className={cn(
          'text-[11px] px-3 py-2 rounded-lg font-medium',
          seedMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400',
        )}>
          {seedMsg.text}
        </p>
      )}

      {/* Search + category filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук серед усіх каналів..."
            className="w-full bg-secondary rounded-lg pl-8 pr-8 py-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        {categories.length > 1 && (
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="bg-secondary rounded-lg px-2 py-2 text-xs outline-none max-w-[140px]"
          >
            <option value="">Всі</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Add channel form */}
      {showForm && isAdmin && (
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
          <p className="text-xs font-semibold">Новий канал / група</p>
          {([
            { key: 'title',          placeholder: 'Назва каналу',                     label: 'Назва' },
            { key: 'usernameOrLink', placeholder: '@username або https://t.me/...',    label: 'Username / посилання' },
            { key: 'category',       placeholder: 'Категорія (необов\'язково)',         label: 'Категорія' },
          ] as const).map(({ key, placeholder, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">{label}</label>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Тип</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none">
                <option value="channel">Канал</option>
                <option value="group">Група</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Мова</label>
              <select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none">
                <option value="uk">Українська</option>
                <option value="ru">Російська</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold active:scale-95 transition-all disabled:opacity-50">
              {saving ? 'Збереження...' : 'Додати'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2.5 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold active:scale-95 transition-all">
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* Stats row */}
      {total > 0 && (
        <p className="text-[10px] text-muted-foreground px-1">
          {debouncedSearch || filterCat
            ? `${channels.length} з ${total.toLocaleString('uk-UA')} каналів`
            : `${total.toLocaleString('uk-UA')} каналів`
          }
          {loading && <span className="ml-2 text-muted-foreground/60">Завантаження...</span>}
        </p>
      )}

      {/* Channel rows */}
      {channels.length === 0 && !loading ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">
            {debouncedSearch || filterCat
              ? 'Нічого не знайдено за вашим запитом.'
              : isAdmin
                ? 'Немає каналів. Натисніть «Завантажити 10k+ каналів» для імпорту.'
                : 'Немає доступних каналів. Зверніться до адміністратора.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {channels.map((ch) => (
            <div key={ch.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold',
                ch.type === 'channel' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground',
              )}>
                {ch.type === 'channel' ? 'C' : 'G'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{ch.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">@{ch.usernameOrLink}</p>
                <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                  <span className={cn('text-[10px] font-medium', ch.status === 'active' ? 'text-green-400' : 'text-muted-foreground')}>
                    {ch.status === 'active' ? 'Активний' : 'Неактивний'}
                  </span>
                  {ch.notes && <span className="text-[10px] text-muted-foreground">· {ch.notes}</span>}
                  {ch.category && <span className="text-[10px] text-muted-foreground/70">· {ch.category}</span>}
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => handleDelete(ch.id)} className="text-muted-foreground hover:text-red-400 transition-colors active:scale-90">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-6 flex items-center justify-center">
            {loading && hasMore && <RefreshCw size={14} className="animate-spin text-muted-foreground" />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create campaign form ───────────────────────────────────────────────────────
function CreateCampaignForm({ userId, user, onCreated }: {
  userId?: string; user: SaaSUser | null; onCreated: () => void;
}) {
  const plan       = user?.subscriptionPlan ?? 'free';
  const isAdmin    = user?.role === 'owner' || user?.role === 'admin';
  const limits     = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  // admin/owner and unlimited plan get Infinity — no cap at all
  const channelCap = (isAdmin || plan === 'unlimited' || limits.channels >= 999999) ? Infinity : limits.channels;
  const accountCap = limits.telegramAccounts >= 999 ? Infinity : limits.telegramAccounts;

  // Ukrainian display names for plans
  const PLAN_NAMES_UA: Record<string, string> = {
    free:      'Безкоштовний',
    basic:     'Базовий',
    pro:       'Преміум',
    premium:   'Преміум',
    agency:    'Агентський',
    unlimited: 'Необмежений',
  };
  const planNameUA = PLAN_NAMES_UA[plan] ?? plan;

  const [activeChannels, setActiveChannels] = useState<TelegramChannel[]>([]);
  const [chLoading, setChLoading]           = useState(true);
  const [chSearch, setChSearch]             = useState('');
  const [accounts, setAccounts]             = useState<TelegramAccount[]>([]);
  const [acLoading, setAcLoading]           = useState(true);

  // Load active channels up to the plan limit (max 5000 rows for the picker)
  useEffect(() => {
    setChLoading(true);
    const cap = channelCap === Infinity ? 5000 : Math.min(channelCap, 5000);
    fetch(`/api/channels?pageSize=${cap}&status=active`)
      .then((r) => r.json())
      .then((res) => { if (res?.ok) setActiveChannels(res.channels ?? []); })
      .catch(() => {})
      .finally(() => setChLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // Load active Telegram accounts for sender picker.
  // Uses the /active sub-route (no admin guard) — passes userId so it only
  // returns accounts that belong to this user and have status === 'active'.
  const loadAccounts = () => {
    if (!userId) return;
    setAcLoading(true);
    fetch(`/api/telegram/accounts/active?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok) setAccounts(res.accounts as TelegramAccount[]);
      })
      .catch(() => {})
      .finally(() => setAcLoading(false));
  };

  useEffect(() => {
    loadAccounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const [form, setForm] = useState({
    title:              '',
    messageText:        '',
    selectedAccountIds: [] as string[],
    scheduleType:       'now' as 'now' | 'scheduled' | 'interval' | 'daily',
    scheduledAt:        '',
    delayMinSeconds:    3,
    delayMaxSeconds:    10,
    selectedChannels:   [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const charCount = form.messageText.length;

  const atAccountCap = accountCap !== Infinity && form.selectedAccountIds.length >= accountCap;
  const atChannelCap = channelCap !== Infinity && form.selectedChannels.length >= channelCap;

  const toggleAccount = (id: string) => {
    setForm((f) => {
      const has = f.selectedAccountIds.includes(id);
      if (!has && accountCap !== Infinity && f.selectedAccountIds.length >= accountCap) return f;
      return {
        ...f,
        selectedAccountIds: has
          ? f.selectedAccountIds.filter((a) => a !== id)
          : [...f.selectedAccountIds, id],
      };
    });
  };

  const toggleChannel = (id: string) => {
    setForm((f) => {
      const has = f.selectedChannels.includes(id);
      if (!has && channelCap !== Infinity && f.selectedChannels.length >= channelCap) return f;
      return {
        ...f,
        selectedChannels: has
          ? f.selectedChannels.filter((c) => c !== id)
          : [...f.selectedChannels, id],
      };
    });
  };

  const handleSelectAllChannels = () => {
    const visible = activeChannels.filter(
      (ch) => !chSearch || ch.title.toLowerCase().includes(chSearch.toLowerCase()) || (ch.usernameOrLink ?? '').toLowerCase().includes(chSearch.toLowerCase()),
    );
    const limited = channelCap === Infinity ? visible : visible.slice(0, channelCap);
    setForm((f) => ({ ...f, selectedChannels: limited.map((c) => c.id) }));
  };

  const handleCreate = async () => {
    if (!userId || !form.title.trim() || !form.messageText.trim() || form.selectedChannels.length === 0) {
      setError('Заповніть назву, повідомлення і виберіть хоча б один канал');
      return;
    }
    haptic.medium(); setSaving(true); setError(null);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          // Send first selected account as primary accountId for backward compat,
          // plus full accountIds array for multi-account rotation
          accountId:        form.selectedAccountIds[0] ?? undefined,
          accountIds:       form.selectedAccountIds.length > 0 ? form.selectedAccountIds : undefined,
          title:            form.title,
          messageText:      form.messageText,
          targetChannelIds: form.selectedChannels,
          scheduleType:     form.scheduleType,
          scheduledAt:      form.scheduledAt || undefined,
          delayMinSeconds:  form.delayMinSeconds,
          delayMaxSeconds:  form.delayMaxSeconds,
        }),
      }).then((r) => r.json());
      if (res.ok) { haptic.success(); onCreated(); }
      else { setError(res.error ?? 'Помилка створення'); haptic.error(); }
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <p className="text-xs font-semibold">Нова кампанія</p>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Назва кампанії</label>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Наприклад: Анонс нового сервісу" className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Текст повідомлення ({charCount} / 4096)</label>
          <textarea
            value={form.messageText}
            onChange={(e) => setForm((f) => ({ ...f, messageText: e.target.value }))}
            placeholder="Текст, який буде відправлено у канали..."
            rows={5}
            maxLength={4096}
            className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none resize-none"
          />
        </div>

        {/* Multi-account sender selector */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Users size={10} />
              Акаунти-відправники
              {/* Show X/Y only when accounts are loaded and there are some available */}
              {!acLoading && accounts.length > 0 && (
                <span className="text-muted-foreground/60">
                  ({form.selectedAccountIds.length}/{accountCap === Infinity ? accounts.length : Math.min(accounts.length, accountCap)})
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              {/* Refresh button — lets user reload without full page reload */}
              <button onClick={loadAccounts} disabled={acLoading}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                <RefreshCw size={10} className={acLoading ? 'animate-spin' : ''} />
              </button>
              {form.selectedAccountIds.length > 0 && (
                <button onClick={() => setForm((f) => ({ ...f, selectedAccountIds: [] }))}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                  Скинути
                </button>
              )}
            </div>
          </div>
          {acLoading ? (
            <div className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
              <RefreshCw size={12} className="text-muted-foreground flex-shrink-0 animate-spin" />
              <p className="text-[11px] text-muted-foreground">Завантаження акаунтів...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
              <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <p className="text-[11px] font-medium text-yellow-400">Немає активних акаунтів</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Підключіть MTProto-акаунт у розділі «Адмін → TG Акаунти», після чого натисніть кнопку оновлення вище.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {accounts.map((a) => {
                  const selected = form.selectedAccountIds.includes(a.id);
                  const disabled = !selected && atAccountCap;
                  return (
                    <button key={a.id} onClick={() => toggleAccount(a.id)}
                      disabled={disabled}
                      className={cn(
                        'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95',
                        selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/30',
                        disabled && 'opacity-40 cursor-not-allowed',
                      )}>
                      <div className={cn(
                        'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
                        selected ? 'bg-primary border-primary' : 'border-muted-foreground',
                      )}>
                        {selected && <CheckCircle2 size={10} className="text-primary-foreground" />}
                      </div>
                      <Smartphone size={11} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium">{a.phoneNumber}</span>
                    </button>
                  );
                })}
              </div>
              {atAccountCap && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle size={11} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-yellow-400">
                    Досягнуто ліміт акаунтів для плану &laquo;{planNameUA}&raquo; ({accountCap}). Для більшої кількості оновіть підписку.
                  </p>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Кампанія буде рівномірно розподілена між обраними акаунтами.
              </p>
            </>
          )}
        </div>

        {/* Schedule */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Тип розсилки</label>
          <select value={form.scheduleType}
            onChange={(e) => setForm((f) => ({ ...f, scheduleType: e.target.value as typeof form.scheduleType }))}
            className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none">
            <option value="now">Відразу</option>
            <option value="daily">Щодня (час рандомізується)</option>
            <option value="scheduled">За розкладом</option>
            <option value="interval">З інтервалом</option>
          </select>
          {form.scheduleType === 'daily' && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
              <Clock size={12} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Кампанія запускатиметься щодня в рандомний час (08:00–22:00 Kyiv). Кожен акаунт отримує унікальний слот.
              </p>
            </div>
          )}
        </div>

        {form.scheduleType === 'scheduled' && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Час запуску</label>
            <input type="datetime-local" value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
          </div>
        )}

        {/* Delay */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Мін. затримка (сек)</label>
            <input type="number" min={1} value={form.delayMinSeconds}
              onChange={(e) => setForm((f) => ({ ...f, delayMinSeconds: Number(e.target.value) }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Макс. затримка (с��к)</label>
            <input type="number" min={1} value={form.delayMaxSeconds}
              onChange={(e) => setForm((f) => ({ ...f, delayMaxSeconds: Number(e.target.value) }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
          </div>
        </div>
      </div>

      {/* Channel selection */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">
            Канали ({form.selectedChannels.length}{' / '}{channelCap === Infinity ? activeChannels.length.toLocaleString('uk-UA') : channelCap})
          </p>
          {form.selectedChannels.length > 0 && (
            <button onClick={() => setForm((f) => ({ ...f, selectedChannels: [] }))}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Скинути
            </button>
          )}
        </div>

        {/* Plan channel limit badge */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/60">
          <span className="text-[10px] text-muted-foreground">
            Ліміт плану <span className="font-semibold text-foreground">{planNameUA}</span>:
          </span>
          <span className="text-[10px] font-semibold text-primary">
            {channelCap === Infinity ? 'Необмежено' : `${channelCap.toLocaleString('uk-UA')} каналів`}
          </span>
        </div>

        {chLoading ? (
          <div className="flex items-center justify-center py-4">
            <RefreshCw size={14} className="animate-spin text-muted-foreground" />
          </div>
        ) : activeChannels.length === 0 ? (
          <p className="text-xs text-muted-foreground">Немає активних каналів. Додайте у вкладці &ldquo;Канали&rdquo;.</p>
        ) : (
          <>
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={chSearch}
                onChange={(e) => setChSearch(e.target.value)}
                placeholder="Фільтр каналів..."
                className="w-full bg-secondary rounded-lg pl-8 py-2 text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center justify-between">
              <button onClick={handleSelectAllChannels} className="text-[10px] text-primary font-medium">
                Вибрати всі ({channelCap === Infinity ? activeChannels.length : Math.min(channelCap, activeChannels.length)})
              </button>
              {atChannelCap && (
                <span className="text-[10px] text-yellow-400 flex items-center gap-1">
                  <AlertTriangle size={9} /> Ліміт досягнуто
                </span>
              )}
            </div>
            {atChannelCap && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle size={11} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-400">
                  Досягнуто ліміт {channelCap.toLocaleString('uk-UA')} каналів для плану &laquo;{planNameUA}&raquo;. Оновіть підписку, щоб розсилати в більше каналів.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
              {activeChannels
                .filter((ch) => !chSearch || ch.title.toLowerCase().includes(chSearch.toLowerCase()) || (ch.usernameOrLink ?? '').toLowerCase().includes(chSearch.toLowerCase()))
                .map((ch) => {
                  const selected = form.selectedChannels.includes(ch.id);
                  const disabled = !selected && atChannelCap;
                  return (
                    <button key={ch.id} onClick={() => toggleChannel(ch.id)}
                      disabled={disabled}
                      className={cn(
                        'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95',
                        selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/30',
                        disabled && 'opacity-40 cursor-not-allowed',
                      )}>
                      <div className={cn(
                        'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
                        selected ? 'bg-primary border-primary' : 'border-muted-foreground',
                      )}>
                        {selected && <CheckCircle2 size={10} className="text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{ch.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{ch.usernameOrLink}</p>
                      </div>
                    </button>
                  );
                })}
            </div>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        onClick={handleCreate}
        disabled={saving || accounts.length === 0}
        title={accounts.length === 0 ? 'Спочатку підключіть хоча б один MTProto-акаунт' : undefined}
        className="py-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
        {saving ? 'Створення...' : accounts.length === 0 ? 'Потрібен акаунт-відправник' : 'Створити кампанію'}
      </button>
    </div>
  );
}
