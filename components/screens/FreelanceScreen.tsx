'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, RefreshCw, Plus, Settings2, Trash2,
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp,
  Play, Square, KeyRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { SaaSUser, FreelanceAccount, FreelanceFilter } from '@/types';

const DEFAULT_ALLOWED = [
  'wordpress','opencart','shopify','woocommerce','website','вебсайт','сайт',
  'лендинг','landing','frontend','backend','react','next.js','vue','php',
  'laravel','python','node.js','javascript','typescript','api','crm',
  'integration','інтеграція','автоматизація','telegram bot','telegram mini app',
  'bot','бот','seo','google ads','meta ads','facebook ads','ga4','gtm','pixel',
  'tracking','ai app','openai','parser','scraping','парсер','saas',
];
const DEFAULT_BLOCKED = [
  'video','відео','reels','tiktok','motion','canva','presentation',
  'презентація','photo','photography','зйомка','image generation',
  'генерація картинок','banner','smm','instagram','content creator',
  'editing','монтаж','copywriting','копірайтинг','translation','переклад',
  'transcription','транскрибація','supplier','постачальник','gambling',
  'betting','гемблінг','ставки',
];

interface Props { user: SaaSUser | null; }

type SubTab = 'connect' | 'settings' | 'applications';

export function FreelanceScreen({ user }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('connect');
  const [account, setAccount] = useState<FreelanceAccount | null>(null);
  const [filter, setFilter]   = useState<FreelanceFilter | null>(null);
  const [loading, setLoading] = useState(true);

  const userId = user?.id;

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [accRes, filterRes] = await Promise.all([
        fetch(`/api/freelance/account?userId=${userId}`).then((r) => r.json()).catch(() => null),
        fetch(`/api/freelance/settings?userId=${userId}`).then((r) => r.json()).catch(() => null),
      ]);
      if (accRes?.ok) setAccount(accRes.account ?? null);
      if (filterRes?.ok) setFilter(filterRes.filter ?? null);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const tabs: Array<{ id: SubTab; label: string }> = [
    { id: 'connect',      label: 'Підключення' },
    { id: 'settings',     label: 'Налаштування' },
    { id: 'applications', label: 'Заявки' },
  ];

  return (
    <div className="px-4 pt-5 pb-28 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Freelancehunt</h1>
        <button
          onClick={() => { haptic.light(); load(); }}
          className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex rounded-xl bg-secondary p-0.5 gap-0.5">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { haptic.light(); setSubTab(id); }}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all',
              subTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {subTab === 'connect'      && <ConnectPanel userId={userId} account={account} onRefresh={load} />}
          {subTab === 'settings'     && <FilterPanel userId={userId} filter={filter} onSaved={setFilter} />}
          {subTab === 'applications' && <ApplicationsPanel userId={userId} />}
        </>
      )}
    </div>
  );
}

// ── Connect panel ─────────────────────────────────────────────────────────────
function ConnectPanel({ userId, account, onRefresh }: {
  userId?: string; account: FreelanceAccount | null; onRefresh: () => void;
}) {
  const [token, setToken]         = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [runResult, setRunResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [jobStats, setJobStats]   = useState<{ found: number; submitted: number; skipped: number; failed: number } | null>(null);

  const isConnected = account?.status === 'connected' && !!account?.apiToken;

  const handleConnect = async () => {
    if (!userId || !token.trim()) return;
    haptic.medium();
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/freelance/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token: token.trim() }),
      }).then((r) => r.json());
      if (res.ok) {
        haptic.success();
        setToken('');
        setShowTokenInput(false);
        onRefresh();
      } else {
        setError(res.error ?? 'Помилка підключення');
        haptic.error();
      }
    } finally { setSaving(false); }
  };

  const handleDisconnect = async () => {
    if (!userId) return;
    haptic.error();
    await fetch('/api/freelance/disconnect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    setShowTokenInput(false);
    onRefresh();
  };

  const handleToggleWorker = async (start: boolean) => {
    if (!userId) return;
    haptic.medium();
    setWorkerBusy(true);
    setRunResult(null);
    if (start) setJobStats(null);
    try {
      const res = await fetch(start ? '/api/freelance/start' : '/api/freelance/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Помилка мережі' }));

      if (start && res.ok) {
        haptic.success();
        const found     = res.found     ?? 0;
        const submitted = res.submitted ?? 0;
        const skipped   = (res.filter?.dailyLimit ?? found) - submitted;
        setRunResult({ ok: true, msg: `Знайдено ${found}, надіслано ${submitted}` });
        setJobStats({ found, submitted, skipped: Math.max(0, skipped), failed: res.errors?.length ?? 0 });
        setTimeout(() => setRunResult(null), 8000);
      } else if (!start && res.ok) {
        haptic.success();
        setRunResult({ ok: true, msg: 'Автопошук зупинено' });
        setTimeout(() => setRunResult(null), 4000);
      } else {
        const msg = res.error ?? 'Помилка запуску';
        setRunResult({ ok: false, msg });
        haptic.error();
        if (res.setupRequired) setShowTokenInput(true);
      }
      onRefresh();
    } finally { setWorkerBusy(false); }
  };

  const statusMap = {
    connected:    { icon: Wifi,    cls: 'text-green-400',         bg: 'bg-green-500/10 border-green-500/20',   label: 'Підключено' },
    disconnected: { icon: WifiOff, cls: 'text-muted-foreground',  bg: 'bg-secondary border-border',            label: 'Не підключено' },
    expired:      { icon: Clock,   cls: 'text-yellow-400',        bg: 'bg-yellow-500/10 border-yellow-500/20', label: 'Сесія закінчилась' },
    error:        { icon: XCircle, cls: 'text-red-400',           bg: 'bg-red-500/10 border-red-500/20',       label: 'Помилка' },
  } as const;

  const statusKey = (isConnected ? 'connected' : (account?.status ?? 'disconnected')) as keyof typeof statusMap;
  const s    = statusMap[statusKey] ?? statusMap.disconnected;
  const Icon = s.icon;

  return (
    <div className="flex flex-col gap-4">
      {/* Status card */}
      <div className={cn('p-4 rounded-2xl border flex items-center gap-3', s.bg)}>
        <div className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center',
          isConnected ? 'bg-green-500/20' : 'bg-secondary',
        )}>
          <Icon size={16} className={s.cls} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{s.label}</p>
          {isConnected && account?.accountName && (
            <p className="text-[11px] text-muted-foreground truncate">@{account.accountName}</p>
          )}
          {isConnected && account?.lastCheckAt && (
            <p className="text-[11px] text-muted-foreground">
              Перевірено: {new Date(account.lastCheckAt).toLocaleString('uk-UA')}
            </p>
          )}
          {!isConnected && (
            <p className="text-[11px] text-muted-foreground">Додайте API токен для роботи</p>
          )}
        </div>
        {isConnected && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />}
      </div>

      {/* Auto-bid trigger — only when truly connected with token */}
      {isConnected && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => handleToggleWorker(true)}
              disabled={workerBusy}
              className="flex-1 py-3 rounded-xl bg-green-500/15 text-green-400 border border-green-500/20 text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
            >
              {workerBusy ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
              {workerBusy ? 'Пошук...' : 'Запустити пошук заявок'}
            </button>
            <button
              onClick={() => handleToggleWorker(false)}
              disabled={workerBusy}
              className="py-3 px-4 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold flex items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
            >
              <Square size={13} />
            </button>
          </div>
          {runResult && (
            <p className={cn('text-[11px] text-center px-2', runResult.ok ? 'text-green-400' : 'text-red-400')}>
              {runResult.msg}
            </p>
          )}
          {jobStats && (
            <div className="grid grid-cols-4 gap-2 mt-1">
              {[
                { label: 'Знайдено',  value: jobStats.found },
                { label: 'Надіслано', value: jobStats.submitted },
                { label: 'Пропущено', value: jobStats.skipped },
                { label: 'Помилок',   value: jobStats.failed },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-secondary border border-border p-2 text-center">
                  <p className="text-sm font-bold">{value}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connect / update token form */}
      {(!isConnected || showTokenInput) && (
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              {isConnected ? 'Оновити API токен' : 'Підключити Freelancehunt'}
            </p>
            {showTokenInput && isConnected && (
              <button onClick={() => { setShowTokenInput(false); setError(null); }} className="text-[11px] text-muted-foreground">Скасувати</button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Введіть ваш Freelancehunt API токен. Токен безпечно зберігається на сервері.{'\n'}
            Де взяти: <span className="text-foreground">freelancehunt.com → Профіль → Налаштування → API</span>
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
            placeholder="Вставте токен тут…"
            autoComplete="off"
            className="w-full bg-secondary rounded-xl px-3 py-2.5 text-xs font-mono outline-none border border-border focus:border-primary transition-colors"
          />
          {error && (
            <div className="flex items-start gap-1.5 text-red-400">
              <XCircle size={12} className="mt-0.5 flex-shrink-0" />
              <p className="text-[11px]">{error}</p>
            </div>
          )}
          <button
            onClick={handleConnect}
            disabled={saving || !token.trim()}
            className="py-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? 'Перевірка токену...' : isConnected ? 'Оновити токен' : 'Підключити'}
          </button>
        </div>
      )}

      {/* Update token button — when connected and form is hidden */}
      {isConnected && !showTokenInput && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowTokenInput(true); }}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 size={12} /> Оновити токен
          </button>
          <span className="text-border">·</span>
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 text-xs text-red-400/70 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} /> Відключити
          </button>
        </div>
      )}
    </div>
  );
}

// ── Filter / Settings panel ───────────────────────────────────────────────────
function FilterPanel({ userId, filter, onSaved }: {
  userId?: string; filter: FreelanceFilter | null; onSaved: (f: FreelanceFilter) => void;
}) {
  const [form, setForm] = useState({
    minBudgetUah:    filter?.minBudgetUah    ?? 2000,
    minBudgetUsd:    filter?.minBudgetUsd    ?? 50,
    aiScoreMin:      filter?.aiScoreMin      ?? 60,
    dailyLimit:      filter?.dailyLimit      ?? 20,
    proposalStyle:   filter?.proposalStyle   ?? 'expert',
    isEnabled:       filter?.isEnabled       ?? false,
    allowedKeywords: filter?.allowedKeywords ?? DEFAULT_ALLOWED,
    blockedKeywords: filter?.blockedKeywords ?? DEFAULT_BLOCKED,
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showAllowed, setShowAllowed] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [newAllowed, setNewAllowed] = useState('');
  const [newBlocked, setNewBlocked] = useState('');

  const handleSave = async () => {
    if (!userId) return;
    haptic.medium(); setSaving(true); setSuccess(false);
    try {
      const res = await fetch('/api/freelance/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...form }),
      }).then((r) => r.json());
      if (res.ok) { haptic.success(); setSuccess(true); onSaved(res.filter); setTimeout(() => setSuccess(false), 2000); }
    } finally { setSaving(false); }
  };

  const addKeyword = (type: 'allowed' | 'blocked', kw: string) => {
    const trimmed = kw.trim().toLowerCase();
    if (!trimmed) return;
    if (type === 'allowed') {
      if (!form.allowedKeywords.includes(trimmed))
        setForm((f) => ({ ...f, allowedKeywords: [...f.allowedKeywords, trimmed] }));
      setNewAllowed('');
    } else {
      if (!form.blockedKeywords.includes(trimmed))
        setForm((f) => ({ ...f, blockedKeywords: [...f.blockedKeywords, trimmed] }));
      setNewBlocked('');
    }
  };

  const removeKeyword = (type: 'allowed' | 'blocked', kw: string) => {
    if (type === 'allowed') setForm((f) => ({ ...f, allowedKeywords: f.allowedKeywords.filter((k) => k !== kw) }));
    else setForm((f) => ({ ...f, blockedKeywords: f.blockedKeywords.filter((k) => k !== kw) }));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Enable toggle */}
      <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold">Автоматизація</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Увімкнути автоматичний пошук та відгук</p>
        </div>
        <button
          onClick={() => setForm((f) => ({ ...f, isEnabled: !f.isEnabled }))}
          className={cn(
            'relative w-11 h-6 rounded-full transition-all duration-300',
            form.isEnabled ? 'bg-green-500' : 'bg-secondary'
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300',
            form.isEnabled ? 'left-5' : 'left-0.5'
          )} />
        </button>
      </div>

      {/* Budget & limits */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <p className="text-xs font-semibold flex items-center gap-1.5"><Settings2 size={12} /> Бюджет та ліміти</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Мін. бюджет UAH', key: 'minBudgetUah', unit: '₴' },
            { label: 'Мін. бюджет USD', key: 'minBudgetUsd', unit: '$' },
          ].map(({ label, key, unit }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">{label}</label>
              <div className="flex items-center gap-1 bg-secondary rounded-lg px-2.5 py-2">
                <span className="text-[11px] text-muted-foreground">{unit}</span>
                <input
                  type="number"
                  value={form[key as keyof typeof form] as number}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                  className="flex-1 bg-transparent text-xs outline-none min-w-0"
                />
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Мін. AI рейтинг (%)</label>
            <input
              type="number" min={0} max={100}
              value={form.aiScoreMin}
              onChange={(e) => setForm((f) => ({ ...f, aiScoreMin: Number(e.target.value) }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground">Денний ліміт</label>
            <input
              type="number" min={1} max={100}
              value={form.dailyLimit}
              onChange={(e) => setForm((f) => ({ ...f, dailyLimit: Number(e.target.value) }))}
              className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none"
            />
          </div>
        </div>

        {/* Proposal style */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Стиль відгуку</label>
          <select
            value={form.proposalStyle}
            onChange={(e) => setForm((f) => ({ ...f, proposalStyle: e.target.value as FreelanceFilter['proposalStyle'] }))}
            className="bg-secondary rounded-lg px-2.5 py-2 text-xs outline-none"
          >
            {['short','expert','friendly','premium','professional','detailed','creative'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Allowed keywords */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <button
          onClick={() => setShowAllowed((v) => !v)}
          className="flex items-center justify-between w-full"
        >
          <p className="text-xs font-semibold text-green-400">
            Дозволені ключові слова ({form.allowedKeywords.length})
          </p>
          {showAllowed ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
        {showAllowed && (
          <>
            <div className="flex flex-wrap gap-1">
              {form.allowedKeywords.map((kw) => (
                <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px]">
                  {kw}
                  <button onClick={() => removeKeyword('allowed', kw)} className="text-green-400/60 hover:text-green-400">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newAllowed}
                onChange={(e) => setNewAllowed(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword('allowed', newAllowed)}
                placeholder="Додати ключове слово..."
                className="flex-1 bg-secondary rounded-lg px-2.5 py-1.5 text-xs outline-none"
              />
              <button onClick={() => addKeyword('allowed', newAllowed)} className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold">
                +
              </button>
            </div>
          </>
        )}
      </div>

      {/* Blocked keywords */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <button
          onClick={() => setShowBlocked((v) => !v)}
          className="flex items-center justify-between w-full"
        >
          <p className="text-xs font-semibold text-red-400">
            Заблоковані ключові слова ({form.blockedKeywords.length})
          </p>
          {showBlocked ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
        {showBlocked && (
          <>
            <div className="flex flex-wrap gap-1">
              {form.blockedKeywords.map((kw) => (
                <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px]">
                  {kw}
                  <button onClick={() => removeKeyword('blocked', kw)} className="text-red-400/60 hover:text-red-400">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newBlocked}
                onChange={(e) => setNewBlocked(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword('blocked', newBlocked)}
                placeholder="Додати заблоковане слово..."
                className="flex-1 bg-secondary rounded-lg px-2.5 py-1.5 text-xs outline-none"
              />
              <button onClick={() => addKeyword('blocked', newBlocked)} className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs font-semibold">
                +
              </button>
            </div>
          </>
        )}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className={cn(
          'py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50',
          success ? 'bg-green-500/15 text-green-400' : 'bg-primary text-primary-foreground'
        )}
      >
        {saving ? <RefreshCw size={13} className="animate-spin" /> : success ? <CheckCircle2 size={13} /> : null}
        {saving ? 'Збереження...' : success ? 'Збережено!' : 'Зберегти налаштування'}
      </button>
    </div>
  );
}

// ── Applications panel ────────────────────────────────────────────────────────
function ApplicationsPanel({ userId }: { userId?: string }) {
  type AppStatus = 'all' | 'sent' | 'sent_unconfirmed' | 'skipped' | 'failed';
  const [apps, setApps]   = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab]     = useState<AppStatus>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: AppStatus) => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const url = s === 'all'
        ? `/api/freelance/bids?userId=${userId}`
        : `/api/freelance/bids?userId=${userId}&status=${s}`;
      const res = await fetch(url).then((r) => r.json()).catch(() => null);
      setApps(res?.ok && Array.isArray(res.data) ? res.data : []);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(tab); }, [load, tab]);

  const tabs: Array<{ id: AppStatus; label: string; color: string }> = [
    { id: 'all',             label: 'Всі',                color: '' },
    { id: 'sent',            label: 'Надіслані',          color: 'text-green-400' },
    { id: 'sent_unconfirmed',label: 'Непідтверджені',     color: 'text-blue-400' },
    { id: 'skipped',         label: 'Пропущені',          color: 'text-yellow-400' },
    { id: 'failed',          label: 'Помилки',            color: 'text-red-400' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { haptic.light(); setTab(id); }}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
              tab === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><RefreshCw size={16} className="animate-spin text-muted-foreground" /></div>
      ) : apps.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">Немає заявок для відображення</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {apps.map((app) => {
            const status = app.status as string;
            const statusColor = status === 'sent' ? 'text-green-400' :
              status === 'sent_unconfirmed' ? 'text-blue-400' :
              status === 'skipped' ? 'text-yellow-400' : 'text-red-400';
            const statusLabel = status === 'sent' ? 'Надіслано' :
              status === 'sent_unconfirmed' ? 'Надіслано?' :
              status === 'skipped' ? 'Пропущено' : 'Помилка';
            return (
              <div key={app.id as string} className="glass-card p-3 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{app.title as string}</p>
                    <div className="flex flex-wrap gap-x-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{app.budget as number} {app.currency as string}</span>
                      {app.aiScore !== undefined && <span className="text-[11px] text-muted-foreground">· AI {app.aiScore as number}%</span>}
                    </div>
                    {(app.skippedReason as string) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate opacity-70">{app.skippedReason as string}</p>
                    )}
                    {typeof app.url === 'string' && app.url && (
                      <a href={app.url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-primary mt-0.5 block truncate">
                        {app.url}
                      </a>
                    )}
                  </div>
                  <span className={cn('text-[10px] font-semibold flex-shrink-0', statusColor)}>{statusLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
