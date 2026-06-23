'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, CreditCard, Settings2, ScrollText, ChevronRight,
  Crown, CheckCircle2, XCircle, Clock, Trash2, Plus,
  RefreshCw, Shield, ToggleLeft, ToggleRight, Wallet,
  Smartphone, PhoneCall, KeyRound, AlertTriangle, WifiOff,
  Send, Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { SaaSUser, PaymentSetting, ManualPayment, ManualPaymentPlan, PaymentCurrency, TelegramAccount } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

type AdminTab = 'users' | 'payments' | 'payment-settings' | 'tg-accounts' | 'logs';

interface AdminScreenProps {
  user: SaaSUser | null;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AdminScreen({ user }: AdminScreenProps) {
  const [tab, setTab] = useState<AdminTab>('users');

  if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
    return (
      <div className="px-4 pt-5 pb-28 flex flex-col items-center justify-center gap-3 min-h-[300px]">
        <Shield size={36} className="text-red-400" />
        <p className="text-sm font-semibold">Доступ заборонено</p>
        <p className="text-xs text-muted-foreground text-center">Тільки власник або адміністратор може переглядати цю сторінку.</p>
      </div>
    );
  }

  const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: 'users',            label: 'Користувачі', icon: Users },
    { id: 'payments',         label: 'Платежі',     icon: CreditCard },
    { id: 'payment-settings', label: 'Гаманці',     icon: Wallet },
    { id: 'tg-accounts',      label: 'TG Аккаунти', icon: Smartphone },
    { id: 'logs',             label: 'Логи',        icon: ScrollText },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
          <Shield size={18} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">Admin Panel</h1>
          <p className="text-[11px] text-muted-foreground">
            {user.role === 'owner' ? 'Owner' : 'Admin'} · {user.name}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pb-3">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { haptic.select(); setTab(id); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all',
              tab === id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {tab === 'users'            && <UsersTab user={user} />}
        {tab === 'payments'         && <PaymentsTab user={user} />}
        {tab === 'payment-settings' && <PaymentSettingsTab user={user} />}
        {tab === 'tg-accounts'      && <TelegramAccountsTab user={user} />}
        {tab === 'logs'             && <AdminLogsTab user={user} />}
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  free:      'text-muted-foreground bg-secondary',
  pro:       'text-primary bg-primary/15',
  agency:    'text-yellow-400 bg-yellow-500/15',
  unlimited: 'text-red-400 bg-red-500/15',
};

const ROLE_COLORS: Record<string, string> = {
  user:  'text-muted-foreground',
  admin: 'text-blue-400',
  owner: 'text-red-400',
};

function UsersTab({ user }: { user: SaaSUser }) {
  const [users, setUsers] = useState<SaaSUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SaaSUser | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/users?requesterId=${user.id}`).then((r) => r.json()).catch(() => null);
    setUsers(res?.ok ? res.users : []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const handlePatch = async (userId: string, patch: Record<string, unknown>) => {
    setSaving(true);
    haptic.medium();
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: user.id, userId, ...patch }),
    }).then((r) => r.json()).catch(() => null);
    haptic.success();
    setSaving(false);
    setEditing(null);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{users.length} користувачів</p>
        <button onClick={load} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90">
          <RefreshCw size={12} />
        </button>
      </div>

      {users.map((u) => (
        <div key={u.id} className="glass-card p-3 rounded-2xl flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 text-xs font-bold">
              {u.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-semibold truncate">{u.name}</p>
                <span className={cn('text-[10px] font-medium', ROLE_COLORS[u.role] ?? 'text-muted-foreground')}>
                  {u.role}
                </span>
                {u.isDisabled && <span className="text-[10px] text-red-400 font-medium">disabled</span>}
              </div>
              {u.username && <p className="text-[11px] text-muted-foreground">@{u.username}</p>}
              <p className="text-[10px] text-muted-foreground/60">ID: {u.telegramId}</p>
            </div>
            <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0', PLAN_COLORS[u.subscriptionPlan])}>
              {u.subscriptionPlan}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => { setEditing(u); setNewPlan(u.subscriptionPlan); }}
              className="text-[10px] px-2.5 py-1 rounded-lg bg-secondary text-foreground active:scale-95"
            >
              Змінити план
            </button>
            <button
              onClick={() => handlePatch(u.id, { disabled: !u.isDisabled })}
              disabled={saving || u.telegramId === 6237272293}
              className={cn(
                'text-[10px] px-2.5 py-1 rounded-lg active:scale-95 disabled:opacity-40',
                u.isDisabled ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
              )}
            >
              {u.isDisabled ? 'Розблокувати' : 'Заблокувати'}
            </button>
          </div>

          {/* Inline plan editor */}
          {editing?.id === u.id && (
            <div className="flex gap-1.5 flex-wrap pt-1 border-t border-border">
              {(['free', 'pro', 'agency', 'unlimited'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setNewPlan(p)}
                  className={cn(
                    'text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all',
                    newPlan === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => handlePatch(u.id, { plan: newPlan })}
                disabled={saving}
                className="text-[10px] px-3 py-1 rounded-lg bg-green-500/20 text-green-400 font-semibold disabled:opacity-50"
              >
                {saving ? '...' : 'Зберегти'}
              </button>
              <button onClick={() => setEditing(null)} className="text-[10px] px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                Скасувати
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Payments Tab ──────────────────────────────────────────────────────────────

function PaymentsTab({ user }: { user: SaaSUser }) {
  const [payments, setPayments] = useState<ManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/manual-payments?requesterId=${user.id}&status=${filter}`).then((r) => r.json()).catch(() => null);
    setPayments(res?.ok ? res.payments : []);
    setLoading(false);
  }, [user.id, filter]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (paymentId: string, action: 'approve' | 'reject') => {
    setActioning(paymentId);
    haptic.medium();
    await fetch('/api/admin/manual-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: user.id, paymentId, action }),
    }).then((r) => r.json()).catch(() => null);
    haptic.success();
    setActioning(null);
    load();
  };

  const STATUS_COLORS: Record<string, string> = {
    pending:  'text-yellow-400 bg-yellow-500/15',
    approved: 'text-green-400 bg-green-500/15',
    rejected: 'text-red-400 bg-red-500/15',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Filter tabs */}
      <div className="flex gap-1.5">
        {['pending', 'approved', 'rejected'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('text-[10px] px-3 py-1.5 rounded-lg font-medium', filter === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
            {s}
          </button>
        ))}
        <button onClick={load} className="ml-auto w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90">
          <RefreshCw size={11} />
        </button>
      </div>

      {loading ? <Spinner /> : payments.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">Немає платежів зі статусом «{filter}»</p>
        </div>
      ) : (
        payments.map((p) => (
          <div key={p.id} className="glass-card p-3 rounded-2xl flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{p.userName ?? 'Unknown'}{p.userUsername ? ` (@${p.userUsername})` : ''}</p>
                <p className="text-[11px] text-muted-foreground">
                  Plan: <span className="font-medium text-foreground">{p.plan}</span>
                  {p.amount ? ` · ${p.amount} ${p.currency ?? ''}` : ''}
                </p>
                {p.methodName && <p className="text-[11px] text-muted-foreground">Метод: {p.methodName}</p>}
                {p.transactionId && <p className="text-[11px] text-muted-foreground">TX: {p.transactionId}</p>}
                {p.proofNote && <p className="text-[11px] text-muted-foreground/70 italic">{p.proofNote}</p>}
                <p className="text-[10px] text-muted-foreground/50">{new Date(p.createdAt).toLocaleString('uk-UA')}</p>
              </div>
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0', STATUS_COLORS[p.status])}>
                {p.status}
              </span>
            </div>
            {p.status === 'pending' && (
              <div className="flex gap-2 pt-1 border-t border-border">
                <button
                  onClick={() => handleAction(p.id, 'approve')}
                  disabled={actioning === p.id}
                  className="flex-1 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-semibold active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <CheckCircle2 size={11} /> Підтвердити
                </button>
                <button
                  onClick={() => handleAction(p.id, 'reject')}
                  disabled={actioning === p.id}
                  className="flex-1 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-semibold active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <XCircle size={11} /> Відхилити
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Payment Settings Tab ──────────────────────────────────────────────────────

const CURRENCIES: PaymentCurrency[] = ['UAH', 'USD', 'EUR', 'USDT', 'BTC'];

const EMPTY_FORM = { methodName: '', address: '', instructions: '', currency: 'UAH' as PaymentCurrency, isActive: true };

function PaymentSettingsTab({ user }: { user: SaaSUser }) {
  const [settings, setSettings] = useState<PaymentSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, id: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/payment-settings?requesterId=${user.id}`).then((r) => r.json()).catch(() => null);
    setSettings(res?.ok ? res.settings : []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.methodName.trim() || !form.address.trim()) return;
    setSaving(true);
    haptic.medium();
    const { id, ...body } = form;
    await fetch('/api/admin/payment-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: user.id, ...(id ? { id } : {}), ...body }),
    }).then((r) => r.json()).catch(() => null);
    haptic.success();
    setSaving(false);
    setShowForm(false);
    setForm({ ...EMPTY_FORM, id: '' });
    load();
  };

  const handleDelete = async (id: string) => {
    haptic.error();
    await fetch('/api/admin/payment-settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: user.id, id }),
    });
    load();
  };

  const handleEdit = (s: PaymentSetting) => {
    setForm({ id: s.id, methodName: s.methodName, address: s.address, instructions: s.instructions, currency: s.currency, isActive: s.isActive });
    setShowForm(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => { setForm({ ...EMPTY_FORM, id: '' }); setShowForm((v) => !v); }}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/15 text-primary text-xs font-semibold self-start active:scale-95"
      >
        <Plus size={12} /> Додати спосіб оплати
      </button>

      {showForm && (
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
          <p className="text-xs font-semibold">{form.id ? 'Редагувати' : 'Новий спосіб оплати'}</p>
          <input value={form.methodName} onChange={(e) => setForm((f) => ({ ...f, methodName: e.target.value }))}
            placeholder="Назва (напр. Monobank UAH)" className="form-input" />
          <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Номер карти / IBAN / адреса" className="form-input" />
          <textarea value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            placeholder="Інструкції для платника" rows={3} className="form-input resize-none" />
          <div className="flex gap-2">
            <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as PaymentCurrency }))}
              className="form-input flex-1">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              className={cn('flex items-center gap-1.5 px-3 rounded-xl text-xs font-medium', form.isActive ? 'bg-green-500/15 text-green-400' : 'bg-secondary text-muted-foreground')}
            >
              {form.isActive ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {form.isActive ? 'Active' : 'Inactive'}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
              {saving ? 'Збереження...' : 'Зберегти'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl bg-secondary text-xs text-muted-foreground">
              Скасувати
            </button>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : settings.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">Немає способів оплати. Додайте перший.</p>
        </div>
      ) : (
        settings.map((s) => (
          <div key={s.id} className="glass-card p-3 rounded-2xl flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">{s.methodName}</p>
                  <span className={cn('text-[10px] font-medium', s.isActive ? 'text-green-400' : 'text-muted-foreground/50')}>
                    {s.isActive ? 'active' : 'inactive'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground font-mono truncate">{s.address}</p>
                <p className="text-[10px] text-muted-foreground/60">{s.currency}</p>
                {s.instructions && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{s.instructions}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => handleEdit(s)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90">
                  <Settings2 size={12} />
                </button>
                <button onClick={() => handleDelete(s.id)} className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 active:scale-90">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Admin Logs Tab ────────────────────────────────────────────────────────────

function AdminLogsTab({ user }: { user: SaaSUser }) {
  const [logs, setLogs] = useState<Array<{ id: string; level: string; message: string; timestamp: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/logs?userId=${user.id}&limit=100`).then((r) => r.json()).catch(() => null);
    const rawLogs: Array<Record<string, unknown>> = res?.ok ? (res.logs ?? res.data ?? []) : [];
    setLogs(rawLogs.map((entry) => ({
      id:        String(entry.id ?? Math.random()),
      level:     String(entry.level ?? 'info'),
      message:   typeof entry.message === 'string'
                   ? entry.message
                   : entry.message != null ? JSON.stringify(entry.message) : '(no message)',
      timestamp: String(entry.timestamp ?? entry.created_at ?? new Date().toISOString()),
    })));
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const LEVEL_COLORS: Record<string, string> = {
    info:    'text-blue-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error:   'text-red-400',
  };

  return (
    <div className="flex flex-col gap-2">
      <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground self-end px-3 py-1.5 bg-secondary rounded-lg active:scale-90">
        <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Оновити
      </button>
      {loading ? <Spinner /> : logs.length === 0 ? (
        <div className="glass-card p-6 rounded-2xl text-center">
          <p className="text-xs text-muted-foreground">Логів немає</p>
        </div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="glass-card px-3 py-2 rounded-xl flex gap-2">
            <span className={cn('text-[10px] font-semibold uppercase w-14 flex-shrink-0 pt-px', LEVEL_COLORS[log.level] ?? 'text-muted-foreground')}>
              {log.level}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-foreground leading-snug">{typeof log.message === 'string' ? log.message : JSON.stringify(log.message)}</p>
              <p className="text-[10px] text-muted-foreground/50">{new Date(log.timestamp).toLocaleString('uk-UA')}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Telegram Accounts Tab ───────────────────�����─────────────────────────────────

type WizardStep = 'idle' | 'phone' | 'code' | 'password' | 'done';

const STATUS_LABEL: Record<TelegramAccount['status'], string> = {
  pending:    'Очікує',
  code_sent:  'Код відправлено',
  active:     'Активний',
  flood_wait: 'FloodWait',
  banned:     'Заблоковано',
  invalid:    'Помилка',
};

const STATUS_COLOR: Record<TelegramAccount['status'], string> = {
  pending:    'text-muted-foreground bg-secondary',
  code_sent:  'text-yellow-400 bg-yellow-500/15',
  active:     'text-green-400 bg-green-500/15',
  flood_wait: 'text-orange-400 bg-orange-500/15',
  banned:     'text-red-400 bg-red-500/15',
  invalid:    'text-red-400 bg-red-500/15',
};

function TelegramAccountsTab({ user }: { user: SaaSUser }) {
  const [accounts, setAccounts]     = useState<TelegramAccount[]>([]);
  const [loading, setLoading]       = useState(true);
  const [step, setStep]             = useState<WizardStep>('idle');
  const [phone, setPhone]           = useState('');
  const [code, setCode]             = useState('');
  const [password, setPassword]     = useState('');
  const [working, setWorking]       = useState(false);
  const [error, setError]           = useState('');
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [isCodeViaApp, setIsCodeViaApp]         = useState(false);
  const [codeType, setCodeType]                 = useState('');
  const [nextType, setNextType]                 = useState<string | null>(null);
  const [codeTimeout, setCodeTimeout]           = useState<number | null>(null);
  const [resendCooldown, setResendCooldown]     = useState(0);
  const [testingId, setTestingId]               = useState<string | null>(null);
  const [testResult, setTestResult]             = useState<Record<string, boolean>>({});
  const [sendCodeDebug, setSendCodeDebug]       = useState<{
    url: string;
    status: number;
    json: Record<string, unknown>;
    phoneHashExists: boolean;
    telegramError?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/accounts');
      const data = await res.json() as { ok: boolean; accounts?: TelegramAccount[] };
      if (data.ok) setAccounts(data.accounts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  // ── Step 1: register phone → create account row ───────────────────────────
  async function handleAddPhone() {
    if (!phone.trim()) return;
    setError('');
    setWorking(true);
    try {
      const res = await fetch('/api/telegram/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, phoneNumber: phone.trim() }),
      });
      const data = await res.json() as { ok: boolean; account?: TelegramAccount; error?: string };
      if (!data.ok) { setError(data.error ?? 'Помилка'); return; }
      const accountId = data.account!.id;
      setCurrentAccountId(accountId);
      // Send OTP
      const codeUrl = '/api/telegram/accounts/send-code';
      const codeRes = await fetch(codeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, requesterId: user.id }),
      });
      const codeData = await codeRes.json() as {
        ok: boolean; error?: string; telegramError?: string;
        isCodeViaApp?: boolean; phoneHashExists?: boolean;
        codeType?: string; nextType?: string | null; timeout?: number | null;
      };
      // Always populate debug panel so developer can see exactly what happened
      setSendCodeDebug({
        url:             codeUrl,
        status:          codeRes.status,
        json:            codeData as Record<string, unknown>,
        phoneHashExists: codeData.phoneHashExists ?? false,
        telegramError:   codeData.telegramError,
      });
      if (!codeData.ok) {
        setError(codeData.telegramError ?? codeData.error ?? 'Не вдалося відправити код');
        return;
      }
      // Only advance when Telegram confirmed the send with a real phoneCodeHash
      if (!codeData.phoneHashExists) {
        setError('Telegram не повернув phoneCodeHash — код не відправлено');
        return;
      }
      setIsCodeViaApp(codeData.isCodeViaApp ?? false);
      setCodeType(codeData.codeType ?? '');
      setNextType(codeData.nextType ?? null);
      setCodeTimeout(codeData.timeout ?? null);
      // Start a 60s resend cooldown (or use Telegram's timeout if provided)
      setResendCooldown(codeData.timeout ?? 60);
      setStep('code');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setWorking(false);
    }
  }

  // ── Step 2: verify OTP ─────────────────────────────────────────────────────
  async function handleVerifyCode() {
    if (!code.trim() || !currentAccountId) return;
    setError('');
    setWorking(true);
    try {
      const res = await fetch('/api/telegram/accounts/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: currentAccountId, code: code.trim() }),
      });
      const data = await res.json() as {
        ok: boolean; requires2fa?: boolean; error?: string;
        codeExpired?: boolean; authRestart?: boolean;
      };
      if (!data.ok) {
        if (data.requires2fa)  { setStep('password'); return; }
        if (data.codeExpired)  { setError('Код протермінований. Натисніть "Надіслати знову" щоб отримати новий.'); return; }
        if (data.authRestart)  { setError('Telegram вимагає перезапуску. Натисніть "Скасувати і почати заново".'); return; }
        setError(data.error ?? 'Невірний код');
        return;
      }
      setStep('done');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setWorking(false);
    }
  }

  // ── Step 3 (optional): 2FA password ───────────────────────────────────────
  async function handleVerifyPassword() {
    if (!password.trim() || !currentAccountId) return;
    setError('');
    setWorking(true);
    try {
      const res = await fetch('/api/telegram/accounts/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: currentAccountId, code: code.trim(), password: password.trim() }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? 'Невірний пароль 2FA'); return; }
      setStep('done');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setWorking(false);
    }
  }

  /** Apply a successful send/resend response to UI state */
  function applyCodeResponse(
    res: { ok: true; isCodeViaApp?: boolean; codeType?: string; nextType?: string | null; timeout?: number | null },
    url: string,
    rawStatus: number,
    rawJson: Record<string, unknown>,
  ) {
    setSendCodeDebug({ url, status: rawStatus, json: rawJson, phoneHashExists: true });
    setIsCodeViaApp(res.isCodeViaApp ?? false);
    setCodeType(res.codeType ?? '');
    setNextType(res.nextType ?? null);
    setCodeTimeout(res.timeout ?? null);
    setResendCooldown(res.timeout ?? 60);
    setCode('');
    setStep('code');
  }

  /** Send a fresh OTP — used when resending to an existing account from the list */
  async function handleResendCode(accountId: string) {
    setError('');
    setWorking(true);
    setCurrentAccountId(accountId);
    setSendCodeDebug(null);
    try {
      const url = '/api/telegram/accounts/send-code';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, requesterId: user.id }),
      });
      const data = await res.json() as {
        ok: boolean; error?: string; telegramError?: string;
        isCodeViaApp?: boolean; phoneHashExists?: boolean;
        codeType?: string; nextType?: string | null; timeout?: number | null;
      };
      setSendCodeDebug({
        url, status: res.status, json: data as Record<string, unknown>,
        phoneHashExists: data.phoneHashExists ?? false, telegramError: data.telegramError,
      });
      if (!data.ok) { setError(data.telegramError ?? data.error ?? 'Не вдалося відправити код'); return; }
      if (!data.phoneHashExists) { setError('Telegram не повернув phoneCodeHash — код не відправлено'); return; }
      applyCodeResponse(data as Parameters<typeof applyCodeResponse>[0], url, res.status, data as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка мережі');
    } finally {
      setWorking(false);
    }
  }

  /** Resend via auth.ResendCode so Telegram delivers via nextType (SMS/call) */
  async function handleResendViaNextType() {
    if (!currentAccountId) return;
    setError('');
    setWorking(true);
    try {
      const url = '/api/telegram/accounts/resend-code';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: currentAccountId }),
      });
      const data = await res.json() as {
        ok: boolean; error?: string; telegramError?: string;
        isCodeViaApp?: boolean; phoneHashExists?: boolean; sessionExpired?: boolean;
        codeType?: string; nextType?: string | null; timeout?: number | null;
      };
      setSendCodeDebug({
        url, status: res.status, json: data as Record<string, unknown>,
        phoneHashExists: data.phoneHashExists ?? false, telegramError: data.telegramError,
      });
      if (!data.ok) {
        // OTP session expired — need a full restart
        if (data.sessionExpired) {
          setError('Сесія авторизації протермінувалась. Натисніть "Скасувати і почати заново".');
          return;
        }
        setError(data.telegramError ?? data.error ?? 'Не вдалося відправити код');
        return;
      }
      if (!data.phoneHashExists) { setError('Telegram не повернув phoneCodeHash'); return; }
      applyCodeResponse(data as Parameters<typeof applyCodeResponse>[0], url, res.status, data as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка мережі');
    } finally {
      setWorking(false);
    }
  }

  /**
   * Clear the existing OTP session for this account, then immediately call sendCode again
   * with a completely fresh TelegramClient. Use this when the code never arrived.
   */
  async function handleResetSessionAndResend() {
    if (!currentAccountId) return;
    setError('');
    setWorking(true);
    setSendCodeDebug(null);
    try {
      // 1. Delete the stored OTP session so the next sendCode starts completely fresh
      await fetch(`/api/telegram/accounts/otp-session?accountId=${currentAccountId}`, { method: 'DELETE' });
    } catch { /* non-fatal — proceed even if delete fails */ }

    try {
      // 2. Trigger a brand new sendCode with a clean StringSession
      const url = '/api/telegram/accounts/send-code';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: currentAccountId, forceNewSession: true }),
      });
      const data = await res.json() as {
        ok: boolean; error?: string; telegramError?: string;
        isCodeViaApp?: boolean; phoneHashExists?: boolean;
        codeType?: string; nextType?: string | null; timeout?: number | null;
      };
      setSendCodeDebug({
        url, status: res.status, json: data as Record<string, unknown>,
        phoneHashExists: data.phoneHashExists ?? false, telegramError: data.telegramError,
      });
      if (!data.ok) { setError(data.telegramError ?? data.error ?? 'Не вдалося відправити код'); return; }
      if (!data.phoneHashExists) { setError('Telegram не повернув phoneCodeHash — код не відправлено'); return; }
      applyCodeResponse(data as Parameters<typeof applyCodeResponse>[0], url, res.status, data as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка мережі');
    } finally {
      setWorking(false);
    }
  }

  /** Delete the account row + clear local state so user can start completely fresh */
  async function handleCancelAndRestart() {
    setError('');
    if (currentAccountId) {
      try {
        await fetch(`/api/telegram/accounts?id=${currentAccountId}`, { method: 'DELETE' });
      } catch { /* ignore — even if delete fails, reset UI */ }
    }
    resetWizard();
    await load();
  }

  async function handleTestConnection(accountId: string) {
    setTestingId(accountId);
    try {
      const res = await fetch('/api/telegram/accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      setTestResult(prev => ({ ...prev, [accountId]: data.ok }));
      if (!data.ok) {
        setTestResult(prev => ({ ...prev, [accountId]: false }));
      }
      await load();
    } catch {
      setTestResult(prev => ({ ...prev, [accountId]: false }));
    } finally {
      setTestingId(null);
    }
  }

  function resetWizard() {
    setStep('idle');
    setPhone('');
    setCode('');
    setPassword('');
    setError('');
    setCurrentAccountId(null);
    setIsCodeViaApp(false);
    setCodeType('');
    setNextType(null);
    setCodeTimeout(null);
    setResendCooldown(0);
    setSendCodeDebug(null);
  }

  async function handleDelete(id: string) {
    haptic.heavy();
    await fetch(`/api/telegram/accounts?id=${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Telegram аккаунти</p>
          <p className="text-[11px] text-muted-foreground">MTProto-сесії для розсилки</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-secondary hover:bg-secondary/70 transition-colors">
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
          {step === 'idle' && (
            <button
              onClick={() => { haptic.select(); setStep('phone'); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-[12px] font-medium"
            >
              <Plus size={13} /> Додати
            </button>
          )}
        </div>
      </div>

      {/* Wizard */}
      {step !== 'idle' && step !== 'done' && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          {step === 'phone' && (
            <>
              <div className="flex items-center gap-2">
                <PhoneCall size={15} className="text-primary" />
                <p className="text-[13px] font-medium">Введіть номер телефону</p>
              </div>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+380501234567"
                className="w-full bg-secondary rounded-xl px-3 py-2.5 text-sm outline-none border border-border focus:border-primary transition-colors"
                autoFocus
              />
            </>
          )}
          {step === 'code' && (
            <>
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-primary" />
                <p className="text-[13px] font-medium">Введіть код з Telegram</p>
              </div>

              {/* Delivery method banner */}
              {isCodeViaApp ? (
                <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 px-3 py-2.5 space-y-1.5">
                  <p className="text-[12px] font-semibold text-blue-400">
                    Код надіслано в Telegram-додаток, не SMS.
                  </p>
                  <p className="text-[11px] text-blue-300/80 leading-relaxed">
                    Відкрийте Telegram на цьому номері &mdash; там має бути системне повідомлення з кодом.
                    Якщо ви не бачите Telegram або код не прийшов &mdash; скористайтесь кнопками нижче.
                  </p>
                </div>
              ) : codeType.toLowerCase().includes('sms') ? (
                <div className="rounded-xl bg-green-500/10 border border-green-500/25 px-3 py-2.5">
                  <p className="text-[12px] text-green-400 font-medium">
                    Код надіслано SMS на вказаний номер.
                  </p>
                </div>
              ) : codeType.toLowerCase().includes('call') ? (
                <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/25 px-3 py-2.5">
                  <p className="text-[12px] text-yellow-400 font-medium">
                    Код надіслано дзвінком &mdash; підніміть слухавку і введіть цифри.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-secondary px-3 py-2.5">
                  <p className="text-[12px] text-muted-foreground">
                    Перевірте Telegram або SMS на вказаному номері.
                  </p>
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="12345"
                maxLength={6}
                className="w-full bg-secondary rounded-xl px-3 py-2.5 text-sm outline-none border border-border focus:border-primary transition-colors tracking-widest"
                autoFocus
              />

              {/* Fallback action buttons */}
              <div className="flex flex-col gap-1.5">
                {/* If code was sent via app and nextType is SMS/call — show targeted fallback */}
                {isCodeViaApp && nextType && currentAccountId && (
                  <button
                    disabled={working || resendCooldown > 0}
                    onClick={handleResendViaNextType}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-[12px] text-blue-400 font-medium disabled:opacity-50 hover:bg-blue-500/20 transition-colors"
                  >
                    <Send size={11} className={working ? 'animate-spin' : ''} />
                    {working
                      ? 'Надсилаю…'
                      : resendCooldown > 0
                        ? `Отримати ${nextType.toLowerCase().includes('sms') ? 'SMS' : nextType.toLowerCase().includes('call') ? 'дзвінок' : nextType} (${resendCooldown}с)`
                        : `Отримати ${nextType.toLowerCase().includes('sms') ? 'SMS' : nextType.toLowerCase().includes('call') ? 'дзвінок' : nextType} замість`}
                  </button>
                )}

                {/* Generic resend (fresh sendCode) with cooldown */}
                {currentAccountId && (
                  <button
                    disabled={working || resendCooldown > 0}
                    onClick={() => handleResendCode(currentAccountId)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border text-[12px] text-muted-foreground disabled:opacity-50 hover:bg-secondary/60 transition-colors"
                  >
                    <RefreshCw size={11} className={working ? 'animate-spin' : ''} />
                    {working
                      ? 'Надсилаю…'
                      : resendCooldown > 0
                        ? `Надіслати знову (${resendCooldown}с)`
                        : 'Надіслати код ще раз'}
                  </button>
                )}

                {/* Reset OTP session and send fresh code — for when code never arrived */}
                {currentAccountId && (
                  <button
                    disabled={working}
                    onClick={handleResetSessionAndResend}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-orange-500/30 bg-orange-500/10 text-[12px] text-orange-400 disabled:opacity-50 hover:bg-orange-500/15 transition-colors"
                  >
                    <RefreshCw size={11} className={working ? 'animate-spin' : ''} />
                    Скинути сесію і надіслати знову
                  </button>
                )}

                {/* Cancel and full restart — clears account row */}
                <button
                  disabled={working}
                  onClick={handleCancelAndRestart}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] text-red-400/80 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  Скасувати і почати заново
                </button>
              </div>
            </>
          )}
          {step === 'password' && (
            <>
              <div className="flex items-center gap-2">
                <Shield size={15} className="text-primary" />
                <p className="text-[13px] font-medium">2FA пароль</p>
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Ваш пароль двофакторної аутентифікації"
                className="w-full bg-secondary rounded-xl px-3 py-2.5 text-sm outline-none border border-border focus:border-primary transition-colors"
                autoFocus
              />
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2">
              <AlertTriangle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-red-400 break-words">{typeof error === 'string' ? error : JSON.stringify(error)}</p>
            </div>
          )}

          {/* Debug panel — always shown after attempting to send code */}
          {sendCodeDebug && (
            <div className="rounded-xl border border-border bg-secondary/50 p-3 flex flex-col gap-1.5 text-[10px] font-mono overflow-x-auto">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide font-sans mb-0.5">
                Debug: Telegram send-code
              </p>
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground">Status:</span>
                <span className={sendCodeDebug.status === 200 ? 'text-green-400' : 'text-red-400'}>
                  {sendCodeDebug.status}
                </span>
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground">phoneHashExists:</span>
                <span className={sendCodeDebug.phoneHashExists ? 'text-green-400' : 'text-red-400'}>
                  {String(sendCodeDebug.phoneHashExists)}
                </span>
              </div>
              {codeType && (
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground">codeType:</span>
                  <span className="text-yellow-400">{codeType}</span>
                </div>
              )}
              {nextType && (
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground">nextType:</span>
                  <span className="text-blue-400">{nextType}</span>
                </div>
              )}
              {codeTimeout !== null && (
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground">timeout:</span>
                  <span className="text-foreground">{codeTimeout}s</span>
                </div>
              )}
              {sendCodeDebug.telegramError && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">telegramError:</span>
                  <span className="text-red-400 break-words whitespace-pre-wrap">{sendCodeDebug.telegramError}</span>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">response JSON:</span>
                <span className="text-foreground break-words whitespace-pre-wrap">
                  {JSON.stringify(sendCodeDebug.json, null, 2)}
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={resetWizard}
              className="flex-1 py-2 rounded-xl bg-secondary text-sm text-muted-foreground"
            >
              Скасувати
            </button>
            <button
              disabled={working}
              onClick={step === 'phone' ? handleAddPhone : step === 'code' ? handleVerifyCode : handleVerifyPassword}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {working ? 'Завантаження…' : step === 'phone' ? 'Надіслати код' : step === 'code' ? 'Підтвердити' : 'Увійти'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-2xl bg-green-500/10 border border-green-500/20 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-green-400">Аккаунт підключено</p>
            <button onClick={resetWizard} className="text-[11px] text-muted-foreground underline">Додати ще</button>
          </div>
        </div>
      )}

      {/* Accounts list */}
      {loading ? (
        <Spinner />
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center">
            <WifiOff size={22} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Немає підключених аккаунтів</p>
          <p className="text-[11px] text-muted-foreground max-w-[240px]">
            Додайте Telegram-аккаунт щоб використовувати його для розсилок у каналах.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(acc => (
            <div key={acc.id} className="rounded-2xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                  <Smartphone size={16} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{acc.phoneNumber}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-md', STATUS_COLOR[acc.status])}>
                      {STATUS_LABEL[acc.status]}
                    </span>
                    {acc.lastActiveAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(acc.lastActiveAt).toLocaleDateString('uk-UA')}
                      </span>
                    )}
                    {testResult[acc.id] !== undefined && (
                      <span className={cn('text-[10px] font-medium', testResult[acc.id] ? 'text-green-400' : 'text-red-400')}>
                        {testResult[acc.id] ? 'З\'єднання OK' : 'Недоступний'}
                      </span>
                    )}
                  </div>
                  {acc.errorMessage && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">
                      {typeof acc.errorMessage === 'string' ? acc.errorMessage : JSON.stringify(acc.errorMessage)}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(acc.id)}
                  className="p-2 rounded-xl hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pl-12">
                {(acc.status === 'code_sent' || acc.status === 'invalid' || acc.status === 'pending') && step === 'idle' && (
                  <button
                    disabled={working && currentAccountId === acc.id}
                    onClick={() => handleResendCode(acc.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <Send size={11} />
                    {working && currentAccountId === acc.id ? 'Надсилаю…' : 'Надіслати код знову'}
                  </button>
                )}
                {acc.status === 'active' && (
                  <button
                    disabled={testingId === acc.id}
                    onClick={() => handleTestConnection(acc.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <Wifi size={11} />
                    {testingId === acc.id ? 'Перевіряю…' : 'Тест з\'єднання'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
    </div>
  );
}
