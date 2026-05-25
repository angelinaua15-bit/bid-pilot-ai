'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Plus, Send, CheckCircle2, XCircle, Clock,
  ChevronRight, Trash2, Play, Pause, Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import type { SaaSUser, Campaign, TelegramChannel, CampaignMessage } from '@/types';

interface Props { user: SaaSUser | null; }
type SubTab = 'channels' | 'campaigns' | 'create';

export function CampaignsScreen({ user }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('campaigns');
  const [channels, setChannels]   = useState<TelegramChannel[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);

  const userId = user?.id;
  const isPro  = user?.subscriptionPlan === 'pro' || user?.subscriptionPlan === 'agency' || user?.subscriptionPlan === 'unlimited' || user?.role === 'owner' || user?.role === 'admin';

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [chRes, cmpRes] = await Promise.all([
        fetch('/api/channels').then((r) => r.json()).catch(() => null),
        fetch(`/api/campaigns?userId=${userId}`).then((r) => r.json()).catch(() => null),
      ]);
      if (chRes?.ok)  setChannels(chRes.channels ?? []);
      if (cmpRes?.ok) setCampaigns(cmpRes.campaigns ?? []);
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
    { id: 'channels',  label: 'Канали' },
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
          {subTab === 'channels'  && <ChannelsList channels={channels} onRefresh={load} isAdmin={user?.role === 'admin' || user?.role === 'owner'} />}
          {subTab === 'create'    && (
            <CreateCampaignForm userId={userId} channels={channels} onCreated={() => { setSubTab('campaigns'); load(); }} />
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, CampaignMessage[]>>({});

  const loadMessages = async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}/logs`).then((r) => r.json()).catch(() => null);
    if (res?.ok) setMessages((m) => ({ ...m, [id]: res.messages ?? [] }));
  };

  const handleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id); loadMessages(id);
  };

  const handleAction = async (id: string, action: 'start' | 'pause') => {
    haptic.medium();
    await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST' });
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
        const statusColor = c.status === 'completed' ? 'text-green-400' :
          c.status === 'running' ? 'text-primary' :
          c.status === 'failed'  ? 'text-red-400' :
          c.status === 'paused'  ? 'text-yellow-400' : 'text-muted-foreground';
        const statusLabel = {
          draft: 'Чернетка', scheduled: 'Запланована', running: 'Виконується',
          paused: 'Призупинена', completed: 'Завершена', failed: 'Помилка',
        }[c.status] ?? c.status;

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
                {c.totalCount > 0 && (c.status === 'running' || c.status === 'completed') && (
                  <div className="h-1 rounded-full bg-secondary mt-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((c.sentCount + c.failedCount) / c.totalCount) * 100)}%` }} />
                  </div>
                )}
              </div>
              <ChevronRight size={14} className={cn('text-muted-foreground flex-shrink-0 transition-transform', expanded === c.id && 'rotate-90')} />
            </button>

            {/* Expanded: actions + message logs */}
            {expanded === c.id && (
              <div className="border-t border-border px-4 pb-4 pt-3 flex flex-col gap-3">
                <div className="flex gap-2">
                  {(c.status === 'draft' || c.status === 'paused') && (
                    <button onClick={() => handleAction(c.id, 'start')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-semibold active:scale-95 transition-all">
                      <Play size={11} /> Запустити
                    </button>
                  )}
                  {c.status === 'running' && (
                    <button onClick={() => handleAction(c.id, 'pause')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-[11px] font-semibold active:scale-95 transition-all">
                      <Pause size={11} /> Пауза
                    </button>
                  )}
                </div>

                {(messages[c.id] ?? []).length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Немає логів розсилки</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(messages[c.id] ?? []).map((msg) => (
                      <div key={msg.id} className="flex items-center gap-2.5">
                        {msg.status === 'sent'    && <CheckCircle2 size={11} className="text-green-400 flex-shrink-0" />}
                        {msg.status === 'failed'  && <XCircle size={11} className="text-red-400 flex-shrink-0" />}
                        {msg.status === 'pending' && <Clock size={11} className="text-muted-foreground flex-shrink-0" />}
                        {msg.status === 'skipped' && <Clock size={11} className="text-yellow-400 flex-shrink-0" />}
                        <span className="text-[11px] flex-1 truncate">{msg.channelId}</span>
                        {msg.errorReason && <span className="text-[10px] text-red-400 truncate max-w-[100px]">{msg.errorReason}</span>}
                        {msg.sentAt && <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(msg.sentAt), { addSuffix: true, locale: uk })}
                        </span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Channels list ─────────────────────────────────────────────────────────────
function ChannelsList({ channels, onRefresh, isAdmin }: {
  channels: TelegramChannel[]; onRefresh: () => void; isAdmin: boolean;
}) {
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ title: '', usernameOrLink: '', type: 'channel', language: 'uk', category: '' });
  const [saving, setSaving]       = useState(false);
  const [seeding, setSeeding]     = useState(false);
  const [seedMsg, setSeedMsg]     = useState('');
  const [search, setSearch]       = useState('');
  const [filterCat, setFilterCat] = useState('');

  const handleAdd = async () => {
    if (!form.title.trim() || !form.usernameOrLink.trim()) return;
    haptic.medium(); setSaving(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((r) => r.json());
      if (res.ok) { haptic.success(); setShowForm(false); setForm({ title: '', usernameOrLink: '', type: 'channel', language: 'uk', category: '' }); onRefresh(); }
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    haptic.error();
    await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleSeed = async () => {
    haptic.medium();
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await fetch('/api/channels/seed', { method: 'POST' }).then((r) => r.json());
      if (res.ok) {
        haptic.success();
        const parts: string[] = [`Завантажено ${res.inserted} каналів`];
        if (res.europeGroups)      parts.push(`${res.europeGroups} груп українців в Європі`);
        if (res.catalogueChannels) parts.push(`${res.catalogueChannels} з тематичного каталогу`);
        setSeedMsg(parts.join(' · '));
        onRefresh();
      } else {
        haptic.error();
        setSeedMsg(`Помилка: ${res.error ?? 'невідома'}`);
      }
    } finally { setSeeding(false); }
  };

  // Unique categories for filter
  const allCategories = Array.from(new Set(channels.map((c) => c.category).filter(Boolean))).sort();

  const filtered = channels.filter((ch) => {
    const q = search.toLowerCase();
    const matchSearch = !q || ch.title.toLowerCase().includes(q) ||
      (ch.usernameOrLink ?? '').toLowerCase().includes(q) ||
      (ch.notes ?? '').toLowerCase().includes(q);
    const matchCat = !filterCat || ch.category === filterCat;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex flex-col gap-3">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/15 text-primary text-xs font-semibold self-start active:scale-95 transition-transform">
            <Plus size={12} /> Додати канал
          </button>
          <button onClick={handleSeed} disabled={seeding}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/15 text-green-400 text-xs font-semibold self-start active:scale-95 transition-transform disabled:opacity-50">
            <RefreshCw size={12} className={seeding ? 'animate-spin' : ''} />
            {seeding ? 'Завантаження...' : 'Завантажити 2600+ каналів'}
          </button>
        </div>
      )}
      {seedMsg && (
        <p className="text-[11px] px-3 py-2 rounded-lg bg-green-500/10 text-green-400 font-medium">{seedMsg}</p>
      )}

      {/* Search + filter */}
      {channels.length > 5 && (
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук каналу..."
            className="flex-1 bg-secondary rounded-lg px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {allCategories.length > 1 && (
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
              className="bg-secondary rounded-lg px-2 py-2 text-xs outline-none max-w-[140px]">
              <option value="">Всі категорії</option>
              {allCategories.map((c) => <option key={c} value={c!}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      {showForm && isAdmin && (
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
          <p className="text-xs font-semibold">Новий канал / група</p>
          {[
            { key: 'title', placeholder: 'Назва каналу', label: 'Назва' },
            { key: 'usernameOrLink', placeholder: '@username або https://t.me/...', label: 'Username / посилання' },
            { key: 'category', placeholder: 'Категорія (необов\'язково)', label: 'Категорія' },
          ].map(({ key, placeholder, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">{label}</label>
              <input value={form[key as keyof typeof form]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder} className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
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
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold active:scale-95 transition-all">
              Скасувати
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">
            {channels.length === 0
              ? (isAdmin ? 'Немає каналів. Натисніть «Завантажити 2600+ каналів» для імпорту.' : 'Немає доступних каналів. Зверніться до адміністратора.')
              : 'Нічого не знайдено за вашим запитом.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground px-1">{filtered.length} {filtered.length !== channels.length ? `з ${channels.length}` : ''} каналів</p>
          <div className="flex flex-col gap-2">
          {filtered.map((ch) => (
            <div key={ch.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold',
                ch.type === 'channel' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
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
          </div>
        </>
      )}
    </div>
  );
}

// ── Create campaign form ───────────────────────────────────────────────────────
function CreateCampaignForm({ userId, channels, onCreated }: {
  userId?: string; channels: TelegramChannel[]; onCreated: () => void;
}) {
  const activeChannels = channels.filter((c) => c.status === 'active');
  const [form, setForm] = useState({
    title:           '',
    messageText:     '',
    scheduleType:    'now' as 'now' | 'scheduled' | 'interval',
    scheduledAt:     '',
    delayMinSeconds: 3,
    delayMaxSeconds: 10,
    selectedChannels: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const charCount = form.messageText.length;

  const toggleChannel = (id: string) => {
    setForm((f) => ({
      ...f,
      selectedChannels: f.selectedChannels.includes(id)
        ? f.selectedChannels.filter((c) => c !== id)
        : [...f.selectedChannels, id],
    }));
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

        {/* Schedule */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Тип розсилки</label>
          <select value={form.scheduleType}
            onChange={(e) => setForm((f) => ({ ...f, scheduleType: e.target.value as typeof form.scheduleType }))}
            className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none">
            <option value="now">Відразу</option>
            <option value="scheduled">За розкладом</option>
            <option value="interval">З інтервалом</option>
          </select>
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
            <label className="text-[10px] text-muted-foreground">Макс. затримка (сек)</label>
            <input type="number" min={1} value={form.delayMaxSeconds}
              onChange={(e) => setForm((f) => ({ ...f, delayMaxSeconds: Number(e.target.value) }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none" />
          </div>
        </div>
      </div>

      {/* Channel selection */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <p className="text-xs font-semibold">Вибрати канали ({form.selectedChannels.length} / {activeChannels.length})</p>
        {activeChannels.length === 0 ? (
          <p className="text-xs text-muted-foreground">Немає активних каналів. Додайте у вкладці &ldquo;Канали&rdquo;.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
            {activeChannels.map((ch) => {
              const selected = form.selectedChannels.includes(ch.id);
              return (
                <button key={ch.id} onClick={() => toggleChannel(ch.id)}
                  className={cn(
                    'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all active:scale-95',
                    selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-secondary/30'
                  )}>
                  <div className={cn(
                    'w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border',
                    selected ? 'bg-primary border-primary' : 'border-muted-foreground'
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
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button onClick={handleCreate} disabled={saving}
        className="py-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50">
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
        {saving ? 'Створення...' : 'Створити кампанію'}
      </button>
    </div>
  );
}
