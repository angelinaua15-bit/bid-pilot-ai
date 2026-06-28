'use client';

import { useState, useEffect, useCallback } from 'react';
import { Crown, ArrowLeft, Copy, CheckCircle2, Send, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { SaaSUser, PaymentSetting, ManualPayment, ManualPaymentPlan } from '@/types';

interface SubscriptionScreenProps {
  user: SaaSUser | null;
  onBack: () => void;
}

const PLAN_META: Record<ManualPaymentPlan, { label: string; color: string; price: string }> = {
  pro:    { label: 'Premium', color: 'text-primary',    price: '300 грн/міс' },
  agency: { label: 'Agency',  color: 'text-yellow-400', price: '800 грн/міс' },
};

export function SubscriptionScreen({ user, onBack }: SubscriptionScreenProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentSetting[]>([]);
  const [myPayments, setMyPayments] = useState<ManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<ManualPaymentPlan>('pro');
  const [selectedMethod, setSelectedMethod] = useState<PaymentSetting | null>(null);
  const [form, setForm] = useState({ transactionId: '', proofNote: '', amount: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [methodsRes, paymentsRes] = await Promise.all([
      fetch('/api/payment-settings').then((r) => r.json()).catch(() => null),
      user?.id ? fetch(`/api/manual-payments?userId=${user.id}`).then((r) => r.json()).catch(() => null) : null,
    ]);
    const methods = methodsRes?.ok ? methodsRes.settings : [];
    setPaymentMethods(methods);
    if (methods.length > 0) setSelectedMethod(methods[0]);
    setMyPayments(paymentsRes?.ok ? paymentsRes.payments : []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    haptic.light();
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSubmit = async () => {
    if (!user?.id || !selectedMethod) return;
    setSubmitting(true);
    haptic.medium();
    const res = await fetch('/api/manual-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        paymentSettingId: selectedMethod.id,
        methodName: selectedMethod.methodName,
        amount: form.amount ? Number(form.amount) : undefined,
        currency: selectedMethod.currency,
        transactionId: form.transactionId || undefined,
        proofNote: form.proofNote || undefined,
        plan: selectedPlan,
      }),
    }).then((r) => r.json()).catch(() => null);
    setSubmitting(false);
    if (res?.ok) {
      haptic.success();
      setSubmitted(true);
      setForm({ transactionId: '', proofNote: '', amount: '' });
      load();
    } else {
      haptic.error();
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    pending:  'text-yellow-400 bg-yellow-500/15',
    approved: 'text-green-400 bg-green-500/15',
    rejected: 'text-red-400 bg-red-500/15',
  };

  const STATUS_LABELS: Record<string, string> = {
    pending:  'Очікує',
    approved: 'Схвалено',
    rejected: 'Відхилено',
  };

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0">
        <button onClick={() => { haptic.light(); onBack(); }}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold leading-tight">Підписка</h1>
          <p className="text-xs text-muted-foreground">Ручна оплата через адміна</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col gap-4">

        {/* Current plan */}
        {user && (
          <div className="glass-card p-4 rounded-2xl flex items-center gap-3">
            <Crown size={18} className="text-primary flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold">Поточний план: <span className="text-primary">{user.subscriptionPlan}</span></p>
              <p className="text-[11px] text-muted-foreground">Статус: {user.subscriptionStatus}</p>
            </div>
          </div>
        )}

        {/* Plan selector */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Оберіть план</p>
          <div className="flex gap-2">
            {(['pro', 'agency'] as ManualPaymentPlan[]).map((plan) => (
              <button key={plan} onClick={() => setSelectedPlan(plan)}
                className={cn(
                  'flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 border transition-all',
                  selectedPlan === plan ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50'
                )}
              >
                <Crown size={16} className={PLAN_META[plan].color} />
                <span className={cn('text-sm font-bold', PLAN_META[plan].color)}>{PLAN_META[plan].label}</span>
                <span className="text-[11px] text-muted-foreground">{PLAN_META[plan].price}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
          </div>
        ) : paymentMethods.length === 0 ? (
          <div className="glass-card p-6 rounded-2xl text-center">
            <p className="text-sm font-semibold mb-1">Оплата недоступна</p>
            <p className="text-xs text-muted-foreground">Адміністратор ще не додав способи оплати. Зверніться до підтримки.</p>
          </div>
        ) : (
          <>
            {/* Payment method selector */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Спосіб оплати</p>
              {paymentMethods.map((m) => (
                <button key={m.id} onClick={() => setSelectedMethod(m)}
                  className={cn(
                    'glass-card p-3 rounded-2xl text-left border transition-all',
                    selectedMethod?.id === m.id ? 'border-primary' : 'border-transparent'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">{m.methodName}</p>
                    <span className="text-[10px] text-muted-foreground">{m.currency}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-[11px] font-mono text-muted-foreground flex-1 truncate">{m.address}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(m.address, m.id); }}
                      className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 flex-shrink-0"
                    >
                      {copied === m.id ? <CheckCircle2 size={11} className="text-green-400" /> : <Copy size={11} />}
                    </button>
                  </div>
                  {m.instructions && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">{m.instructions}</p>
                  )}
                </button>
              ))}
            </div>

            {/* Payment proof form */}
            {selectedMethod && (
              <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
                <p className="text-xs font-semibold">Підтвердження оплати</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Переведіть кошти та вкажіть ID транзакції або опис. Адміністратор перевірить і активує підписку.
                </p>
                <input
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Сума (напр. 300)"
                  type="number"
                  className="form-input"
                />
                <input
                  value={form.transactionId}
                  onChange={(e) => setForm((f) => ({ ...f, transactionId: e.target.value }))}
                  placeholder="ID транзакції (необов'язково)"
                  className="form-input"
                />
                <textarea
                  value={form.proofNote}
                  onChange={(e) => setForm((f) => ({ ...f, proofNote: e.target.value }))}
                  placeholder="Коментар (напр. 'переказав з картки 4111...')"
                  rows={2}
                  className="form-input resize-none"
                />
                {submitted ? (
                  <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                    <p className="text-xs text-green-400 font-medium">Заявку відправлено! Адмін перевірить найближчим часом.</p>
                  </div>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                  >
                    <Send size={13} />
                    {submitting ? 'Відправлення...' : 'Надіслати підтвердження'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* My payment history */}
        {myPayments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Мої заявки</p>
            {myPayments.map((p) => (
              <div key={p.id} className="glass-card p-3 rounded-xl flex items-center gap-2">
                <Clock size={13} className="text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium">
                    {p.plan} · {p.amount ? `${p.amount} ${p.currency}` : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString('uk-UA')}</p>
                </div>
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold', STATUS_COLORS[p.status])}>
                  {STATUS_LABELS[p.status] ?? p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
