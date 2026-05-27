'use client';

import { useState } from 'react';
import {
  User, Crown, Settings, Wifi, WifiOff, ChevronRight,
  LogOut, Edit2, X, Check, ExternalLink,
} from 'lucide-react';
import { haptic, openExternalLink } from '@/lib/telegram';
import { useTelegramContext } from '@/components/providers/TelegramProvider';
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { mockUser, subscriptionPlans } from '@/lib/mock-data';
import type { NavTab } from '@/types';
import { cn } from '@/lib/utils';

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:   { label: 'Free',   color: 'text-muted-foreground' },
  basic:  { label: 'Basic',  color: 'text-blue-400' },
  pro:    { label: 'Pro',    color: 'text-yellow-400' },
  agency: { label: 'Agency', color: 'text-purple-400' },
};

interface ProfileScreenProps {
  onNavigate: (tab: NavTab) => void;
  onOpenCompanyProfile?: () => void;
}

export function ProfileScreen({ onNavigate, onOpenCompanyProfile }: ProfileScreenProps) {
  const { user: tgUser, isTelegramEnv } = useTelegramContext();
  const profile = mockUser.profile!;
  const subscription = mockUser.subscription!;
  const freelancehunt = mockUser.freelancehunt!;

  const [showLogout, setShowLogout] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState({
    name: profile.name,
    specialization: profile.specialization,
    services: profile.services,
    minBudget: String(profile.minBudget),
  });
  const [savingField, setSavingField] = useState<string | null>(null);

  const generationsUsedPct = Math.round(
    (subscription.generationsUsed / subscription.generationsLimit) * 100
  );
  const planInfo = PLAN_LABELS[subscription.plan] ?? PLAN_LABELS.free;
  const currentPlan = subscriptionPlans.find((p) => p.id === subscription.plan);

  const handleSaveField = async (field: string) => {
    haptic.medium();
    setSavingField(field);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: fieldValues[field as keyof typeof fieldValues] }),
      });
      haptic.success();
    } catch {
      haptic.error();
    } finally {
      setSavingField(null);
      setEditingField(null);
    }
  };

  const avatarLetter = (tgUser?.first_name ?? profile.name ?? 'U')[0].toUpperCase();

  return (
    <div className="flex flex-col h-dvh overflow-y-auto pb-nav px-4 pt-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Профіль</h1>
        {!isTelegramEnv && (
          <span className="text-[10px] bg-yellow-500/15 text-yellow-400 font-semibold px-2.5 py-1 rounded-full border border-yellow-500/30">
            Browser mode
          </span>
        )}
      </div>

      {/* User card */}
      <div className="glass-card rounded-2xl p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center text-primary font-bold text-xl flex-shrink-0">
          {tgUser?.photo_url ? (
            <img src={tgUser.photo_url} alt="avatar" className="w-full h-full rounded-2xl object-cover" />
          ) : (
            avatarLetter
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base truncate">{tgUser?.first_name ?? profile.name}</p>
          {tgUser?.username && (
            <p className="text-xs text-muted-foreground">@{tgUser.username}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            <Crown size={12} className={planInfo.color} />
            <span className={cn('text-xs font-semibold', planInfo.color)}>
              {planInfo.label}
            </span>
            {tgUser?.is_premium && (
              <span className="text-[10px] bg-yellow-500/15 text-yellow-400 font-semibold px-2 py-0.5 rounded-full">
                TG Premium
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Generations progress */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">AI-генерації</span>
          <button
            onClick={() => { haptic.light(); onNavigate('account'); }}
            className="text-xs text-primary font-medium flex items-center gap-1"
          >
            Тариф <ChevronRight size={12} />
          </button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Використано: {subscription.generationsUsed}</span>
          <span>Ліміт: {subscription.generationsLimit}</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              generationsUsedPct > 80 ? 'bg-destructive' : 'bg-primary'
            )}
            style={{ width: `${generationsUsedPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Залишилось:{' '}
          <span className="font-semibold text-foreground">
            {subscription.generationsLimit - subscription.generationsUsed}
          </span>{' '}
          генерацій
        </p>
        {currentPlan && (
          <button
            onClick={() => { haptic.medium(); onNavigate('account'); }}
            className="mt-3 w-full py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs font-semibold transition-all active:scale-95"
          >
            Оновити тариф — {currentPlan.price === 0 ? 'Безкоштовно' : `${currentPlan.price} грн/міс`}
          </button>
        )}
      </div>

      {/* Editable profile fields */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <p className="px-4 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Профіль фрілансера
        </p>
        {(
          [
            { key: 'name',           label: "Ім'я" },
            { key: 'specialization', label: 'Спеціалізація' },
            { key: 'services',       label: 'Послуги' },
            { key: 'minBudget',      label: 'Мін. бюджет ($)' },
          ] as { key: keyof typeof fieldValues; label: string }[]
        ).map(({ key, label }, i, arr) => {
          const isEditing = editingField === key;
          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-3 px-4 py-3',
                i < arr.length - 1 && 'border-b border-border'
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{label}</p>
                {isEditing ? (
                  <input
                    type={key === 'minBudget' ? 'number' : 'text'}
                    value={fieldValues[key]}
                    onChange={(e) =>
                      setFieldValues((v) => ({ ...v, [key]: e.target.value }))
                    }
                    className="tg-input py-1.5 text-sm"
                    autoFocus
                  />
                ) : (
                  <p className="text-sm font-medium truncate">{fieldValues[key]}</p>
                )}
              </div>
              {isEditing ? (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setEditingField(null); haptic.light(); }}
                    className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground"
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={() => handleSaveField(key)}
                    disabled={savingField === key}
                    className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground"
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingField(key); haptic.light(); }}
                  className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0"
                >
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Freelancehunt connection */}
      <ConnectionStatus
        connected={freelancehunt.connected}
        username={freelancehunt.username}
      />

      {/* Links */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {[
          {
            label: 'Портфоліо',
            icon: ExternalLink,
            action: () => openExternalLink(profile.portfolioLinks[0] ?? 'https://'),
          },
          {
            label: 'Профіль компанії',
            icon: Settings,
            action: () => { haptic.light(); onOpenCompanyProfile?.(); },
          },
        ].map(({ label, icon: Icon, action }, i) => (
          <button
            key={label}
            onClick={action}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/50',
              i === 0 && 'border-b border-border'
            )}
          >
            <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0">
              <Icon size={15} />
            </div>
            <span className="flex-1 text-sm font-medium">{label}</span>
            <ChevronRight size={15} className="text-muted-foreground" />
          </button>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={() => { haptic.medium(); setShowLogout(true); }}
        className="w-full py-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
      >
        <LogOut size={16} />
        Вийти з акаунту
      </button>

      <ConfirmModal
        open={showLogout}
        title="Вийти з акаунту?"
        description="Ваші дані залишаться збереженими. Ви зможете увійти знову через Telegram."
        confirmLabel="Вийти"
        cancelLabel="Скасувати"
        destructive
        onConfirm={() => {
          haptic.success();
          setShowLogout(false);
          // TODO: clear session, redirect to welcome
        }}
        onCancel={() => { setShowLogout(false); haptic.light(); }}
      />
    </div>
  );
}
