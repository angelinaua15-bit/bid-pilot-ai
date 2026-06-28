'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, RefreshCw, Settings2,
  CheckCircle2, ChevronDown, ChevronUp,
  Monitor, Loader2,
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

function ConnectPanel({ userId }: {
  userId?: string; account: FreelanceAccount | null; onRefresh: () => void;
}) {
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const code = userId || '';
  // Chrome Web Store link — replace with the real one after publishing.
  const STORE_URL = 'https://chromewebstore.google.com/detail/fbbgkejglpoklgflkfleleinbmemimbb';

  // Expose the connect code so the installed extension can auto-capture it
  // (no manual copy/paste needed).
  useEffect(() => {
    if (!code) return;
    try {
      document.documentElement.dataset.bidpilotCode = code;
      window.postMessage({ type: 'BIDPILOT_CODE', code }, '*');
    } catch { /* ignore */ }
  }, [code]);

  const fetchStats = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const r = await fetch(`/api/freelancehunt/extension-stats?userId=${userId}`).then((x) => x.json()).catch(() => null);
      if (r?.ok) { setStats(r.stats); setRecent(r.recent || []); }
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, 10000);
    return () => clearInterval(t);
  }, [fetchStats]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const connected = !!stats?.connected;
  const fmtTime = (s?: string | null) => s ? new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="flex flex-col gap-4">

      {/* Status */}
      <div className={cn('p-4 rounded-2xl border flex items-center gap-3',
        connected ? 'bg-green-500/10 border-green-500/20' : 'bg-secondary border-border')}>
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', connected ? 'bg-green-500/20' : 'bg-secondary')}>
          {loading ? <Loader2 size={16} className="text-primary animate-spin" /> : connected ? <Wifi size={16} className="text-green-400" /> : <WifiOff size={16} className="text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{connected ? 'Розширення активне' : 'Розширення не підключене'}</p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {connected ? `Остання активність: ${fmtTime(stats?.lastActive)}` : 'Встановіть розширення BidPilot у Chrome і введіть код нижче'}
          </p>
        </div>
        {connected && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />}
      </div>

      {/* Install button */}
      <a href={STORE_URL} target="_blank" rel="noopener noreferrer"
        className="w-full rounded-2xl bg-primary text-primary-foreground px-4 py-3 flex items-center justify-center gap-2 font-semibold text-sm active:scale-[0.99] transition-all">
        <Monitor size={16} /> {connected ? 'Розширення у Chrome Web Store' : 'Встановити розширення'}
      </a>

      {/* Analytics */}
      {connected && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Подано сьогодні', value: stats?.bidsToday ?? 0 },
            { label: 'Подано всього', value: stats?.bidsTotal ?? 0 },
            { label: 'Заповнено форм', value: stats?.filled ?? 0 },
            { label: 'Частка AI', value: (stats?.aiShare ?? 0) + '%' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-2xl bg-secondary border border-border p-3">
              <p className="text-xl font-bold">{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recent activity */}
      {connected && recent.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-xs font-semibold mb-2">Останні заявки</p>
          <div className="flex flex-col gap-1.5 max-h-56 overflow-auto">
            {recent.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', r.status === 'submitted' ? 'bg-green-400' : r.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400')} />
                <span className="flex-1 min-w-0 truncate text-foreground">{r.title || 'Проєкт'}</span>
                {r.amount ? <span className="text-muted-foreground flex-shrink-0">{r.amount} грн</span> : null}
                {r.ai ? <span className="text-primary flex-shrink-0">AI</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connect code */}
      <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2"><Monitor size={14} className="text-primary" /><p className="text-xs font-semibold">Код підключення розширення</p></div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">Вставте цей код у розширення BidPilot → Налаштування → «Код підключення», щоб бачити свою статистику тут.</p>
        <button onClick={copyCode} className="w-full rounded-xl bg-secondary border border-border px-3 py-2.5 flex items-center justify-between gap-2 active:scale-[0.99] transition-all">
          <span className="text-[12px] font-mono text-foreground truncate">{code || '—'}</span>
          <span className={cn('text-[10px] font-semibold flex-shrink-0', copied ? 'text-green-400' : 'text-primary')}>{copied ? 'Скопійовано' : 'Копіювати'}</span>
        </button>
      </div>

      {/* Install guide */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <button onClick={() => setShowGuide((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-semibold">Як встановити розширення у Chrome</span>
          {showGuide ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
        </button>
        {showGuide && (
          <div className="px-4 pb-4">
            <ol className="flex flex-col gap-2 text-[11px] text-muted-foreground leading-relaxed list-decimal list-inside">
              <li>Натисніть <b>«Встановити розширення»</b> вище → <b>Add to Chrome</b>.</li>
              <li>Залогіньтесь на <b>freelancehunt.com</b> у цьому ж Chrome (разово, як завжди).</li>
              <li>Відкрийте цю сторінку застосунку — код підключення <b>підставиться автоматично</b>.</li>
              <li>У розширенні увімкніть <b>Автоподача</b> — і статистика з'явиться тут.</li>
            </ol>
            <p className="text-[10px] text-muted-foreground/70 mt-3 leading-relaxed">Розширення працює лише в десктопному Chrome і поки відкрите вікно браузера. Вхід виконується у вашому браузері — пароль ми не бачимо.</p>
          </div>
        )}
      </div>
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
  type Tab = 'all' | 'submitted' | 'filled' | 'failed';
  interface Bid { title: string | null; amount: number | null; days: number | null; ai: boolean; status: string | null; at: string; }

  const [bids, setBids] = useState<Bid[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/freelancehunt/extension-stats?userId=${userId}`).then((x) => x.json()).catch(() => null);
      setBids(r?.ok && Array.isArray(r.recent) ? r.recent : []);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'all', label: 'Всі' },
    { id: 'submitted', label: 'Подані' },
    { id: 'filled', label: 'Заповнені' },
    { id: 'failed', label: 'Помилки' },
  ];
  const filtered = tab === 'all' ? bids : bids.filter((b) => b.status === tab);
  const fmtTime = (s: string) => new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const meta = (st: string | null) =>
    st === 'submitted' ? { c: 'text-green-400', d: 'bg-green-400', l: 'Подано' } :
    st === 'failed'    ? { c: 'text-red-400',   d: 'bg-red-400',   l: 'Помилка' } :
                         { c: 'text-yellow-400', d: 'bg-yellow-400', l: 'Заповнено' };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {tabs.map(({ id, label }) => (
          <button key={id} onClick={() => { haptic.light(); setTab(id); }}
            className={cn('px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors',
              tab === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><RefreshCw size={16} className="animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-sm font-medium mb-1">Немає заявок</p>
          <p className="text-[11px] text-muted-foreground">Увімкніть «Автоподача» у розширенні — подані заявки з&apos;являться тут.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((b: Bid, i: number) => {
            const m = meta(b.status);
            return (
              <div key={i} className="glass-card p-3 rounded-2xl flex items-center gap-2.5">
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', m.d)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{b.title || 'Проєкт'}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{fmtTime(b.at)}{b.days ? ` · ${b.days} дн` : ''}</p>
                </div>
                {b.amount ? <span className="text-[11px] text-muted-foreground flex-shrink-0">{b.amount} грн</span> : null}
                {b.ai ? <span className="text-[10px] text-primary font-semibold flex-shrink-0">AI</span> : null}
                <span className={cn('text-[10px] font-semibold flex-shrink-0', m.c)}>{m.l}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
} 