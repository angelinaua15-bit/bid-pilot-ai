'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Crown, Zap, Building2, CheckCircle2, XCircle,
  Send, Copy, Clock, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { SaaSUser, PaymentSetting, ManualPayment, ManualPaymentPlan } from '@/types';

// ─── Plan definitions ─────────────────────────────────────────────────────────

interface PlanDef {
  id: ManualPaymentPlan | 'enterprise';
  label: string;
  price: string;
  priceUsd: number;
  period: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
  borderClass: string;
  badgeClass: string;
  ctaClass: string;
  recommended?: boolean;
  benefits: string[];
  limits: { label: string; value: string }[];
}

const PLANS: PlanDef[] = [
  {
    id:          'pro',
    label:       'Premium',
    price:       '$20',
    priceUsd:    20,
    period:      '/місяць',
    description: 'Для фрілансерів-одинаків та невеликих розсилок.',
    icon:        <Zap size={18} />,
    accentClass: 'text-primary',
    borderClass: 'border-primary/40',
    badgeClass:  'bg-primary/15 text-primary',
    ctaClass:    'bg-primary text-primary-foreground',
    benefits: [
      'Telegram-розсилки для невеликих кампаній',
      'Авто-ставки на Freelancehunt для базової генерації лідів',
      'Безпечний розклад надсилання на день',
      'Базові логи кампаній',
      'Ручна заявка на оплату',
    ],
    limits: [
      { label: 'Telegram-акаунти', value: 'До 3' },
      { label: 'Канали / групи',   value: 'До 300' },
      { label: 'Ставки Freelancehunt', value: '20 / місяць' },
    ],
  },
  {
    id:          'agency',
    label:       'Agency',
    price:       '$30',
    priceUsd:    30,
    period:      '/місяць',
    description: 'Для агентств та команд, яким потрібен більший об\'єм.',
    icon:        <Crown size={18} />,
    accentClass: 'text-yellow-400',
    borderClass: 'border-yellow-400/40',
    badgeClass:  'bg-yellow-500/15 text-yellow-400',
    ctaClass:    'bg-yellow-400 text-black',
    recommended: true,
    benefits: [
      'Більше акаунтів-відправників у Telegram',
      'Доступ до більшої бази каналів та груп',
      'Підвищений ліміт ставок на Freelancehunt',
      'Розширені логи кампаній',
      'Покращена ротація акаунтів',
      'Пріоритетна перевірка заявок на оплату',
    ],
    limits: [
      { label: 'Telegram-акаунти',     value: 'До 10' },
      { label: 'Канали / групи',        value: '1 000+' },
      { label: 'Ставки Freelancehunt', value: '100 / місяць' },
    ],
  },
  {
    id:          'enterprise',
    label:       'Enterprise',
    price:       '$50',
    priceUsd:    50,
    period:      '/місяць',
    description: 'Для масштабної автоматизації та повного доступу.',
    icon:        <Building2 size={18} />,
    accentClass: 'text-red-400',
    borderClass: 'border-red-400/40',
    badgeClass:  'bg-red-500/15 text-red-400',
    ctaClass:    'bg-red-500 text-white',
    benefits: [
      'Необмежена кількість Telegram-акаунтів',
      'Необмежена кількість каналів та груп',
      'Необмежені ставки на Freelancehunt',
      'Повний доступ до автоматизації',
      'Пріоритетна підтримка',
      'Ліміти адмін-рівня регулюються вручну',
    ],
    limits: [
      { label: 'Telegram-акаунти',     value: 'Необмежено' },
      { label: 'Канали / групи',        value: 'Необмежено' },
      { label: 'Ставки Freelancehunt', value: 'Необмежено' },
    ],
  },
];

// ─── Comparison table rows ─────────────────────────────────────────────────────

const COMPARE_ROWS = [
  { label: 'Telegram-акаунти',      free: '1',  premium: '3',   agency: '10',   enterprise: '∞' },
  { label: 'Канали / групи',        free: '—',  premium: '300', agency: '1000+',enterprise: '∞' },
  { label: 'Ставок / місяць',       free: '—',  premium: '20',  agency: '100',  enterprise: '∞' },
  { label: 'AI-пропозиції',         free: '—',  premium: '+',   agency: '+',    enterprise: '+' },
  { label: 'Розклад надсилання',    free: '—',  premium: '+',   agency: '+',    enterprise: '+' },
  { label: 'Розширені логи',        free: '—',  premium: '—',   agency: '+',    enterprise: '+' },
  { label: 'Пріоритетна підтримка', free: '—',  premium: '—',   agency: '+',    enterprise: '+' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface PricingScreenProps {
  user: SaaSUser | null;
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PricingScreen({ user, onBack }: PricingScreenProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanDef['id']>('agency');
  const [showPayment, setShowPayment]   = useState(false);
  const [showCompare, setShowCompare]   = useState(false);

  const planDef = PLANS.find((p) => p.id === selectedPlan)!;

  if (showPayment && selectedPlan !== 'enterprise') {
    return (
      <PaymentFlow
        user={user}
        plan={selectedPlan as ManualPaymentPlan}
        planDef={planDef}
        onBack={() => setShowPayment(false)}
        onDone={onBack}
      />
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0">
        <button
          onClick={() => { haptic.light(); onBack(); }}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold leading-tight">Плани</h1>
          <p className="text-xs text-muted-foreground">Оберіть тариф для свого бізнесу</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col gap-5">

        {/* Current plan badge */}
        {user && user.subscriptionPlan !== 'free' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
            <p className="text-xs text-green-400 font-medium">
              Активний план: <span className="font-bold capitalize">{user.subscriptionPlan}</span>
              {user.subscriptionExpiresAt && (
                <span className="font-normal"> · до {new Date(user.subscriptionExpiresAt).toLocaleDateString('uk-UA')}</span>
              )}
            </p>
          </div>
        )}

        {/* Plan cards */}
        <div className="flex flex-col gap-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={selectedPlan === plan.id}
              currentPlan={user?.subscriptionPlan}
              onSelect={() => { haptic.light(); setSelectedPlan(plan.id); }}
            />
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={() => {
            haptic.medium();
            if (selectedPlan === 'enterprise') {
              // Enterprise: show contact info
              setShowPayment(true);
            } else {
              setShowPayment(true);
            }
          }}
          disabled={user?.subscriptionPlan === selectedPlan}
          className={cn(
            'w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40',
            planDef.ctaClass,
          )}
        >
          <Sparkles size={15} />
          {user?.subscriptionPlan === selectedPlan
            ? 'Поточний план'
            : `Перейти на ${planDef.label}`}
        </button>

        {/* Compare toggle */}
        <button
          onClick={() => { haptic.light(); setShowCompare((v) => !v); }}
          className="text-xs text-muted-foreground underline underline-offset-2 text-center"
        >
          {showCompare ? 'Сховати порівняння' : 'Порівняти всі плани'}
        </button>

        {/* Comparison table */}
        {showCompare && <CompareTable />}

        {/* FAQ note */}
        <div className="glass-card p-4 rounded-2xl flex flex-col gap-1.5">
          <p className="text-xs font-semibold">Як активується підписка?</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Після оплати надішліть підтвердження транзакції — адміністратор активує план протягом декількох годин.
            Маєте питання? Напишіть у підтримку.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan, selected, currentPlan, onSelect,
}: {
  plan: PlanDef;
  selected: boolean;
  currentPlan?: string;
  onSelect: () => void;
}) {
  const isCurrent = currentPlan === plan.id;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'glass-card p-4 rounded-2xl text-left border transition-all active:scale-[0.98]',
        selected ? plan.borderClass + ' shadow-sm' : 'border-transparent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', plan.badgeClass)}>
            {plan.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className={cn('text-sm font-bold', plan.accentClass)}>{plan.label}</p>
              {plan.recommended && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400">
                  ПОПУЛЯРНИЙ
                </span>
              )}
              {isCurrent && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                  АКТИВНИЙ
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{plan.description}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={cn('text-xl font-bold', plan.accentClass)}>{plan.price}</p>
          <p className="text-[10px] text-muted-foreground">{plan.period}</p>
        </div>
      </div>

      {selected && (
        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-3">
          {/* Переваги */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Переваги</p>
            {plan.benefits.map((b) => (
              <div key={b} className="flex items-start gap-1.5">
                <CheckCircle2 size={11} className="text-green-400 flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-foreground leading-relaxed">{b}</span>
              </div>
            ))}
          </div>
          {/* Ліміти */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Ліміти</p>
            {plan.limits.map((l) => (
              <div key={l.label} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{l.label}</span>
                <span className={cn('text-[11px] font-semibold', plan.accentClass)}>{l.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}

// ─── Compare table ────────────────────────────────────────────────────────────

function CompareTable() {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Заголовок */}
      <div className="grid grid-cols-8 bg-secondary/60 border-b border-border">
        <div className="col-span-2 px-3 py-2.5 text-[10px] font-semibold text-muted-foreground">Функція</div>
        <div className="col-span-2 px-1 py-2.5 text-[10px] font-semibold text-muted-foreground text-center">Безкоштовно</div>
        <div className="col-span-2 px-1 py-2.5 text-[10px] font-semibold text-primary text-center">Premium</div>
        <div className="col-span-1 px-1 py-2.5 text-[10px] font-semibold text-yellow-400 text-center">Agency</div>
        <div className="col-span-1 px-1 py-2.5 text-[10px] font-semibold text-red-400 text-center">Ent.</div>
      </div>
      {/* Рядок ціни */}
      <div className="grid grid-cols-8 border-b border-border bg-secondary/20">
        <div className="col-span-2 px-3 py-2 text-[10px] text-muted-foreground font-medium">Ціна / міс</div>
        <div className="col-span-2 px-1 py-2 text-[10px] text-center text-muted-foreground">Безкоштовно</div>
        <div className="col-span-2 px-1 py-2 text-[10px] text-center font-bold text-primary">$20</div>
        <div className="col-span-1 px-1 py-2 text-[10px] text-center font-bold text-yellow-400">$30</div>
        <div className="col-span-1 px-1 py-2 text-[10px] text-center font-bold text-red-400">$50</div>
      </div>
      {/* Feature rows */}
      <div className="divide-y divide-border">
        {COMPARE_ROWS.map((row) => (
          <div key={row.label} className="grid grid-cols-8">
            <div className="col-span-2 px-3 py-2.5 text-[11px] text-muted-foreground">{row.label}</div>
            <CompareCell value={row.free}       cols={2} />
            <CompareCell value={row.premium}    cols={2} accent="text-primary" />
            <CompareCell value={row.agency}     cols={1} accent="text-yellow-400" />
            <CompareCell value={row.enterprise} cols={1} accent="text-red-400" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareCell({ value, accent, cols }: { value: string; accent?: string; cols: number }) {
  const isTick  = value === '+';
  const isCross = value === '—';
  return (
    <div className={cn('px-1 py-2.5 flex items-center justify-center', `col-span-${cols}`)}>
      {isTick  ? <CheckCircle2 size={12} className={accent ?? 'text-green-400'} /> :
       isCross ? <span className="text-[11px] text-muted-foreground/40">—</span> :
                 <span className={cn('text-[11px] font-semibold', accent ?? 'text-foreground')}>{value}</span>}
    </div>
  );
}

// ─── Payment flow ─────────────────────────────────────────────────────────────

function PaymentFlow({
  user, plan, planDef, onBack, onDone,
}: {
  user: SaaSUser | null;
  plan: ManualPaymentPlan;
  planDef: PlanDef;
  onBack: () => void;
  onDone: () => void;
}) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentSetting[]>([]);
  const [myPayments, setMyPayments]         = useState<ManualPayment[]>([]);
  const [loading, setLoading]               = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<PaymentSetting | null>(null);
  const [form, setForm]                     = useState({ transactionId: '', proofNote: '', amount: '' });
  const [submitting, setSubmitting]         = useState(false);
  const [submitted, setSubmitted]           = useState(false);
  const [copied, setCopied]                 = useState('');

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
        userId:           user.id,
        paymentSettingId: selectedMethod.id,
        methodName:       selectedMethod.methodName,
        amount:           form.amount ? Number(form.amount) : undefined,
        currency:         selectedMethod.currency,
        transactionId:    form.transactionId || undefined,
        proofNote:        form.proofNote || undefined,
        plan,
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
        <button
          onClick={() => { haptic.light(); onBack(); }}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold leading-tight">{planDef.label}</h1>
          <p className={cn('text-xs font-semibold', planDef.accentClass)}>{planDef.price}{planDef.period}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col gap-4">

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
          </div>
        ) : paymentMethods.length === 0 ? (
          <div className="glass-card p-6 rounded-2xl text-center flex flex-col gap-2">
            <p className="text-sm font-semibold">Оплата недоступна</p>
            <p className="text-xs text-muted-foreground">Адміністратор ще не додав способи оплати. Зверніться у підтримку.</p>
          </div>
        ) : (
          <>
            {/* Payment methods */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Спосіб оплати</p>
              {paymentMethods.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMethod(m)}
                  className={cn(
                    'glass-card p-3 rounded-2xl text-left border transition-all',
                    selectedMethod?.id === m.id ? 'border-primary' : 'border-transparent',
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

            {/* Proof form */}
            {selectedMethod && (
              <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
                <p className="text-xs font-semibold">Підтвердження оплати</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Переведіть кошти, вкажіть суму та ID транзакції. Адмін активує підписку протягом кількох годин.
                </p>
                <input
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder={`Сума (${planDef.price})`}
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
                  placeholder="Коментар..."
                  rows={2}
                  className="form-input resize-none"
                />
                {submitted ? (
                  <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                    <p className="text-xs text-green-400 font-medium">Заявку надіслано! Адмін перевірить н��йближчим часом.</p>
                  </div>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className={cn(
                      'w-full py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 transition-all',
                      plan === 'agency'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    <Send size={13} />
                    {submitting ? 'Відправлення...' : 'Надіслати підтвердження'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Payment history */}
        {myPayments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Мої заявки</p>
            {myPayments.map((p) => (
              <div key={p.id} className="glass-card p-3 rounded-xl flex items-center gap-2">
                <Clock size={13} className="text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium capitalize">
                    {p.plan} {p.amount ? `· ${p.amount} ${p.currency}` : ''}
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
