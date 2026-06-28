'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  User2, Crown, Calendar, Zap, LogOut, ChevronRight,
  AlertTriangle, CheckCircle2, RefreshCw, Shield,
} from 'lucide-react';
import { cn, isOwner, isAdminUser } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import { PricingScreen } from '@/components/screens/PricingScreen';
import type { SaaSUser, SubscriptionPlanSaaS } from '@/types';

// Plan display names and colors
const PLAN_META: Record<SubscriptionPlanSaaS, { label: string; color: string; bg: string }> = {
  free:      { label: 'Безкоштовний', color: 'text-muted-foreground', bg: 'bg-secondary' },
  basic:     { label: 'Базовий',      color: 'text-blue-400',         bg: 'bg-blue-500/15' },
  pro:       { label: 'Преміум',      color: 'text-primary',          bg: 'bg-primary/15' },
  premium:   { label: 'Преміум',      color: 'text-primary',          bg: 'bg-primary/15' },
  agency:    { label: 'Агентський',   color: 'text-yellow-400',       bg: 'bg-yellow-500/15' },
  unlimited: { label: 'Необмежений',  color: 'text-red-400',          bg: 'bg-red-500/15' },
};

interface AccountScreenProps {
  user: SaaSUser | null;
  onUserUpdate: (user: SaaSUser) => void;
  onAdminPanel?: () => void;
}

export function AccountScreen({ user, onUserUpdate, onAdminPanel }: AccountScreenProps) {
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [stats, setStats] = useState<{ total: number; thisMonth: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    if (!user?.id) { setStatsLoading(false); return; }
    try {
      const res = await fetch(`/api/dashboard?userId=${user.id}`).then((r) => r.json()).catch(() => null);
      if (res?.ok) {
        setStats({ total: res.stats.sentTotal, thisMonth: res.stats.applicationsThisMonth });
      }
    } finally { setStatsLoading(false); }
  }, [user?.id]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const refreshUser = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/me`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: user.telegramId, name: user.name, username: user.username }),
      }).then((r) => r.json()).catch(() => null);
      if (res?.ok && res.user) { onUserUpdate(res.user); haptic.success(); }
    } finally { setLoading(false); }
  };

  if (!user) {
    return (
      <div className="px-4 pt-5 pb-28 flex flex-col gap-4">
        <h1 className="text-lg font-bold">Акаунт</h1>
        <div className="glass-card p-4 rounded-2xl text-center">
          <AlertTriangle size={22} className="mx-auto mb-2 text-yellow-400" />
          <p className="text-sm text-muted-foreground">Не вдалося завантажити дані акаунту.</p>
        </div>
      </div>
    );
  }

  const planMeta = PLAN_META[user.subscriptionPlan] ?? PLAN_META.free;
  const userIsOwner = isOwner(user);
  const isExpired = !userIsOwner && user.subscriptionStatus !== 'active';
  const isAdminOrOwner = isAdminUser(user);

  // Show pricing/upgrade screen as overlay
  if (showUpgrade) {
    return <PricingScreen user={user} onBack={() => setShowUpgrade(false)} />;
  }

  return (
    <div className="px-4 pt-5 pb-28 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Акаунт</h1>
        <button
          onClick={() => { haptic.light(); refreshUser(); }}
          disabled={loading}
          className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground active:scale-90 transition-transform disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Profile card */}
      <div className="glass-card p-4 rounded-2xl flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center flex-shrink-0">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="w-12 h-12 rounded-2xl object-cover" />
          ) : (
            <User2 size={22} className="text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{user.name}</p>
          {user.username && (
            <p className="text-xs text-muted-foreground">@{user.username}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">ID: {user.telegramId}</p>
        </div>
        {(user.role === 'owner' || user.role === 'admin') && (
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0',
            user.role === 'owner' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'
          )}>
            {user.role === 'owner' ? 'Owner' : 'Admin'}
          </span>
        )}
      </div>

      {/* Subscription */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown size={15} className={planMeta.color} />
            <span className="text-sm font-semibold">Підписка</span>
          </div>
          <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', planMeta.bg, planMeta.color)}>
            {planMeta.label}
          </span>
        </div>

        {isExpired && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-400">Підписка закінчилась або скасована</p>
          </div>
        )}

        {user.subscriptionExpiresAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar size={13} />
            <span>
              Діє до: {new Date(user.subscriptionExpiresAt).toLocaleDateString('uk-UA')}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <PlanFeatureRow
            plan={user.subscriptionPlan}
            feature="applications"
            label="Заявок / місяць"
            values={{ free: '5', basic: '10', pro: '20', premium: '20', agency: '100', unlimited: 'Необмежено' }}
          />
          <PlanFeatureRow
            plan={user.subscriptionPlan}
            feature="accounts"
            label="Telegram акаунти"
            values={{ free: '1', basic: '1', pro: '3', premium: '3', agency: '10', unlimited: 'Необмежено' }}
          />
          <PlanFeatureRow
            plan={user.subscriptionPlan}
            feature="channels"
            label="Канали / групи"
            values={{ free: '—', basic: '100', pro: '300', premium: '300', agency: '1 000', unlimited: 'Необмежено' }}
          />
          <PlanFeatureRow
            plan={user.subscriptionPlan}
            feature="campaigns"
            label="Telegram розсилки"
            values={{ free: '—', basic: 'Доступно', pro: 'Доступно', premium: 'Доступно', agency: 'Доступно', unlimited: 'Доступно' }}
          />
        </div>

        {!userIsOwner && user.subscriptionPlan !== 'unlimited' && user.subscriptionPlan !== 'agency' && (
          <button
            onClick={() => { haptic.medium(); setShowUpgrade(true); }}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Crown size={13} />
            {user.subscriptionPlan === 'free' || user.subscriptionPlan === 'basic'
              ? 'Оновити до Преміум'
              : 'Оновити до Агентського'}
          </button>
        )}
      </div>

      {/* Admin Panel button */}
      {isAdminOrOwner && onAdminPanel && (
        <button
          onClick={() => { haptic.medium(); onAdminPanel(); }}
          className="glass-card p-4 rounded-2xl flex items-center gap-3 active:scale-95 transition-transform border border-red-500/20 bg-red-500/5"
        >
          <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <Shield size={18} className="text-red-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold">Admin Panel</p>
            <p className="text-[11px] text-muted-foreground">Користувачі, підписки, платежі, логи</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      )}

      {/* Stats */}
      <div className="glass-card p-4 rounded-2xl flex flex-col gap-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Zap size={14} className="text-primary" /> Статистика
        </p>
        {statsLoading ? (
          <div className="h-10 rounded-lg bg-secondary/30 animate-pulse" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/40 rounded-xl p-3 text-center">
              <p className="text-lg font-bold">{stats?.total ?? 0}</p>
              <p className="text-[11px] text-muted-foreground">Всього заявок</p>
            </div>
            <div className="bg-secondary/40 rounded-xl p-3 text-center">
              <p className="text-lg font-bold">{stats?.thisMonth ?? 0}</p>
              <p className="text-[11px] text-muted-foreground">Цього місяця</p>
            </div>
          </div>
        )}
      </div>

      {/* Info rows */}
      <div className="glass-card rounded-2xl overflow-hidden divide-y divide-border">
        <InfoRow label="Статус акаунту" value={user.isDisabled ? 'Заблоковано' : 'Активний'} valueColor={user.isDisabled ? 'text-red-400' : 'text-green-400'} />
        <InfoRow label="Дата реєстрації" value={new Date(user.createdAt).toLocaleDateString('uk-UA')} />
        <InfoRow label="Telegram ID" value={String(user.telegramId)} />
      </div>
    </div>
  );
}

function PlanFeatureRow({
  plan, feature, label, values,
}: {
  plan: SubscriptionPlanSaaS;
  feature: string;
  label: string;
  values: Partial<Record<SubscriptionPlanSaaS, string>>;
}) {
  void feature;
  const val = values[plan] ?? values.agency ?? '';
  const isPositive = val !== 'Недоступно';
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold', isPositive ? 'text-foreground' : 'text-muted-foreground/50')}>
        {isPositive ? (
          <span className="flex items-center gap-1">
            {(val === 'Доступно' || val === 'Необмежено') && <CheckCircle2 size={11} className="text-green-400" />}
            {val}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <LogOut size={10} className="rotate-180" /> {val}
          </span>
        )}
      </span>
    </div>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-medium', valueColor ?? 'text-foreground')}>{value}</span>
    </div>
  );
}
