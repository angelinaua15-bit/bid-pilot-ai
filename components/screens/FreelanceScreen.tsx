'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, RefreshCw, Settings2, Trash2,
  CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Play, Square, Monitor, Loader2, Shield,
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
            onClick={() => {
              console.log('[FreelanceScreen] subTab changed to:', id);
              haptic.light();
              setSubTab(id);
            }}
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
/**
 * ConnectPanel — browser session flow (no deprecated API token).
 *
 * States:
 *   idle        — not yet checked
 *   connecting  — worker opening browser for user login
 *   waiting     — waiting for user to log in (polling every 3 s)
 *   saving      — extracting & saving session to Supabase
 *   connected   — session saved successfully
 *   expired     — session found but check failed
 *   error       — unexpected error
 */
type ConnectStep = 'idle' | 'connecting' | 'waiting' | 'saving' | 'connected' | 'expired' | 'error';

function ConnectPanel({ userId, account, onRefresh }: {
  userId?: string; account: FreelanceAccount | null; onRefresh: () => void;
}) {
  const [token, setToken]         = useState<string | null>(null);
  const [gettingToken, setGetting] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [runResult, setRunResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [jobStats, setJobStats]   = useState<{ found: number; submitted: number; skipped: number; failed: number } | null>(null);

  const isConnected = account?.status === 'connected';

  // While a code is active and not yet connected, poll status so the panel
  // flips to "Підключено" automatically once the extension uploads the session.
  useEffect(() => {
    if (!token || isConnected) return;
    const t = setInterval(() => onRefresh(), 4000);
    return () => clearInterval(t);
  }, [token, isConnected, onRefresh]);

  // Once connected, hide the code UI.
  useEffect(() => { if (isConnected) setToken(null); }, [isConnected]);

  // ── Get a one-time connect code ──────────────────────────────────────────
  const getToken = async () => {
    if (!userId) { setError('Не вдалося визначити користувача'); return; }
    haptic.medium();
    setGetting(true);
    setError(null);
    try {
      const res = await fetch('/api/freelancehunt/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));

      if (res.ok && res.token) {
        setToken(res.token);
        haptic.success();
      } else {
        setError('Не вдалося отримати код. Спробуйте ще раз.');
        haptic.error();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка');
      haptic.error();
    } finally { setGetting(false); }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be blocked — user can select manually */ }
  };

  // ── Disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!userId) return;
    haptic.error();
    await fetch('/api/freelance/disconnect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
    setToken(null);
    setError(null);
    onRefresh();
  };

  // ── Auto-bid trigger ──────────────────────────────────────────────────────
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
        const msg = res.error ?? res.message ?? 'Помилка запуску';
        const isSessionGone = res.setupRequired ||
          msg.includes('NO_SESSION') || msg.includes('LOGIN_REQUIRED') || msg.includes('Reconnect');
        setRunResult({ ok: false, msg: isSessionGone ? 'Потрібно перепідключити акаунт' : msg });
        haptic.error();
        if (isSessionGone) onRefresh();
      }
      onRefresh();
    } finally { setWorkerBusy(false); }
  };

  const statusMap = {
    connected:    { icon: Wifi,    cls: 'text-green-400',         bg: 'bg-green-500/10 border-green-500/20',   label: 'Підключено' },
    disconnected: { icon: WifiOff, cls: 'text-muted-foreground',  bg: 'bg-secondary border-border',            label: 'Не підключено' },
    error:        { icon: XCircle, cls: 'text-red-400',           bg: 'bg-red-500/10 border-red-500/20',       label: 'Помилка' },
  } as const;

  const effectiveStatus = isConnected ? 'connected'
    : error ? 'error'
    : (account?.status === 'connected' ? 'connected' : 'disconnected') as keyof typeof statusMap;
  const s    = statusMap[effectiveStatus] ?? statusMap.disconnected;
  const Icon = s.icon;
  const waiting = !!token && !isConnected;

  return (
    <div className="flex flex-col gap-4">

      {/* Status card */}
      <div className={cn('p-4 rounded-2xl border flex items-center gap-3', s.bg)}>
        <div className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
          isConnected ? 'bg-green-500/20' : 'bg-secondary',
        )}>
          {waiting
            ? <Loader2 size={16} className="text-primary animate-spin" />
            : <Icon size={16} className={s.cls} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {isConnected ? `Підключено${account?.accountName ? ` — @${account.accountName}` : ''}`
              : waiting   ? 'Очікуємо підключення…'
              : s.label}
          </p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {isConnected ? (account?.lastCheckAt
                ? `Оновлено: ${new Date(account.lastCheckAt).toLocaleString('uk-UA')}`
                : 'Сесія активна')
              : waiting ? 'Завершіть кроки в розширенні Chrome'
              : 'Підключіть акаунт через розширення для подачі заявок'}
          </p>
        </div>
        {isConnected && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />}
      </div>

      {/* Error */}
      {error && !isConnected && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2">
          <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Auto-bid trigger — only when connected */}
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

      {/* Connect via extension — when not connected */}
      {!isConnected && (
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Monitor size={14} className="text-primary flex-shrink-0" />
            <p className="text-xs font-semibold">Підключити через розширення</p>
          </div>

          {!token ? (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Вхід виконується у вашому браузері, тож Freelancehunt не блокує його.
                Натисніть «Отримати код», далі завершіть підключення в розширенні BidPilot у Chrome.
              </p>
              <div className="flex items-start gap-2 rounded-xl bg-secondary/60 border border-border p-3">
                <Shield size={12} className="text-primary flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Пароль ми не бачимо — зберігаються лише cookies сесії з вашого браузера.
                </p>
              </div>
              <button
                onClick={getToken}
                disabled={!userId || gettingToken}
                className="py-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
              >
                {gettingToken ? <Loader2 size={13} className="animate-spin" /> : <Monitor size={13} />}
                {gettingToken ? 'Готуємо код…' : 'Отримати код підключення'}
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Ваш код підключення (дійсний 15 хв):</p>
              <button
                onClick={copyToken}
                className="w-full rounded-xl bg-secondary border border-border px-3 py-2.5 flex items-center justify-between gap-2 active:scale-[0.99] transition-all"
              >
                <span className="text-[11px] font-mono text-foreground truncate">{token}</span>
                <span className={cn('text-[10px] font-semibold flex-shrink-0', copied ? 'text-green-400' : 'text-primary')}>
                  {copied ? 'Скопійовано' : 'Копіювати'}
                </span>
              </button>

              <ol className="flex flex-col gap-1.5 mt-1 text-[11px] text-muted-foreground leading-relaxed list-decimal list-inside">
                <li>Встанови розширення <b>BidPilot</b> у Chrome (один раз).</li>
                <li>Увійди на <b>freelancehunt.com</b> у тому самому Chrome.</li>
                <li>Відкрий розширення, встав цей код і натисни <b>«Підключити»</b>.</li>
              </ol>

              <div className="flex items-center justify-center gap-2 py-1 text-[11px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Очікуємо підключення з розширення…
              </div>
              <button
                onClick={() => { setToken(null); setError(null); }}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors self-center"
              >
                Скасувати
              </button>
            </>
          )}
        </div>
      )}

      {/* Disconnect — when connected */}
      {isConnected && (
        <div className="flex items-center gap-3">
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
  const [apps, setApps]     = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab]       = useState<AppStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async (s: AppStatus) => {
    console.log('[FreelanceScreen] ApplicationsPanel load tab:', s, 'userId:', userId);
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ userId, limit: '50' });
      if (s !== 'all') qs.set('status', s);
      const res = await fetch(`/api/applications?${qs}`).then((r) => r.json());
      if (!res?.ok) {
        setError(res?.error ?? 'Не вдалося завантажити заявки');
        setApps([]);
      } else {
        setApps(Array.isArray(res.data) ? res.data : []);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Помилка мережі';
      console.log('[FreelanceScreen] ApplicationsPanel fetch error:', msg);
      setError(msg);
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const handleTabChange = (id: AppStatus) => {
    console.log('[FreelanceScreen] tab changed to:', id);
    haptic.light();
    setTab(id);
  };

  useEffect(() => { load(tab); }, [load, tab]);

  const tabs: Array<{ id: AppStatus; label: string }> = [
    { id: 'all',              label: 'Всі' },
    { id: 'sent',             label: 'Надіслані' },
    { id: 'sent_unconfirmed', label: 'Непідтверджені' },
    { id: 'skipped',          label: 'Пропущені' },
    { id: 'failed',           label: 'Помилки' },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-filter tabs */}
      <div className="flex flex-wrap gap-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
              tab === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error state — inline, never crashes the page */}
      {error && !loading && (
        <div className="glass-card p-4 rounded-2xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
          <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-400">Помилка завантаження</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{error}</p>
            <button
              onClick={() => load(tab)}
              className="mt-2 text-[11px] text-primary font-semibold"
            >
              Спробувати знову
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <RefreshCw size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : !error && apps.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-sm font-medium mb-1">Немає заявок</p>
          <p className="text-[11px] text-muted-foreground">
            {tab === 'all'
              ? 'Запустіть автопошук у вкладці "Підключення", щоб відправити перші заявки.'
              : `Немає заявок зі статусом "${tabs.find((t) => t.id === tab)?.label ?? tab}".`}
          </p>
        </div>
      ) : !error ? (
        <div className="flex flex-col gap-2">
          {apps.map((app) => {
            const status = app.status as string;
            const statusColor =
              status === 'sent'             ? 'text-green-400' :
              status === 'sent_unconfirmed' ? 'text-blue-400'  :
              status === 'skipped'          ? 'text-yellow-400' : 'text-red-400';
            const statusLabel =
              status === 'sent'             ? 'Надіслано'  :
              status === 'sent_unconfirmed' ? 'Надіслано?' :
              status === 'skipped'          ? 'Пропущено'  : 'Помилка';
            const projectUrl = typeof app.url === 'string' && app.url.startsWith('https://') ? app.url : null;

            // Extract human label from error code prefix "CODE: human text"
            const rawError = app.errorReason as string | undefined;
            const errorDisplay = rawError
              ? rawError.includes(': ') ? rawError.split(': ').slice(1).join(': ') : rawError
              : null;
            const errorCode = rawError
              ? rawError.split(':')[0].trim()
              : null;

            const rawSkip = app.skippedReason as string | undefined;
            const skipDisplay = rawSkip
              ? rawSkip.includes(': ') ? rawSkip.split(': ').slice(1).join(': ') : rawSkip
              : null;

            return (
              <div key={app.id as string} className="glass-card p-3 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{app.title as string}</p>
                    <div className="flex flex-wrap gap-x-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {app.budget as number} {app.currency as string}
                      </span>
                      {app.aiScore !== undefined && (
                        <span className="text-[11px] text-muted-foreground">· AI {app.aiScore as number}%</span>
                      )}
                    </div>
                    {skipDisplay && (
                      <p className="text-[10px] text-yellow-400/80 mt-0.5 truncate" title={rawSkip}>
                        {skipDisplay}
                      </p>
                    )}
                    {errorDisplay && (
                      <div className="mt-1 flex flex-col gap-0.5">
                        {errorCode && errorCode !== 'UNKNOWN_ERROR' && (
                          <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 self-start">
                            {errorCode}
                          </span>
                        )}
                        <p className="text-[10px] text-red-400/90 leading-snug" title={rawError}>
                          {errorDisplay}
                        </p>
                      </div>
                    )}
                    {/* Safe open — button with window.open, never <a href> in Telegram WebView */}
                    {projectUrl && (
                      <button
                        onClick={() => {
                          haptic.light();
                          window.open(projectUrl, '_blank', 'noopener,noreferrer');
                        }}
                        className="text-[10px] text-primary mt-0.5 block truncate text-left"
                      >
                        Відкрити проєкт
                      </button>
                    )}
                  </div>
                  <span className={cn('text-[10px] font-semibold flex-shrink-0', statusColor)}>
                    {statusLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}