'use client';

import { useState } from 'react';
import { Crown, Zap, ArrowLeft } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { PricingCard } from '@/components/shared/PricingCard';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { subscriptionPlans, mockUser } from '@/lib/mock-data';
import type { SubscriptionPlan } from '@/types';

interface SubscriptionScreenProps {
  onBack: () => void;
}

export function SubscriptionScreen({ onBack }: SubscriptionScreenProps) {
  const currentPlan = mockUser.subscription?.plan ?? 'free';
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSelectPlan = (plan: SubscriptionPlan) => {
    if (plan.id === currentPlan) return;
    haptic.medium();
    setSelectedPlan(plan);
  };

  const handleCheckout = async () => {
    if (!selectedPlan) return;
    haptic.medium();
    setProcessing(true);
    setSelectedPlan(null);
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlan.id }),
      });
      const json = await res.json();
      // TODO: redirect to payment page json.data.checkoutUrl
      console.log('[Subscription] checkout response:', json);
      haptic.success();
    } catch {
      haptic.error();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          onClick={() => { haptic.light(); onBack(); }}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold leading-tight">Тарифи</h1>
          <p className="text-xs text-muted-foreground">Оберіть план для себе</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* Banner */}
        <div className="glass-card rounded-2xl p-4 mb-4 flex items-center gap-4 border-primary/30 bg-primary/5">
          <div className="w-11 h-11 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Crown size={22} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Поточний тариф</p>
            <p className="text-xs text-muted-foreground">
              {subscriptionPlans.find((p) => p.id === currentPlan)?.name ?? 'Free'} —{' '}
              {(mockUser.subscription?.generationsLimit ?? 10) -
                (mockUser.subscription?.generationsUsed ?? 0)}{' '}
              генерацій залишилось
            </p>
          </div>
          <Zap size={16} className="text-primary flex-shrink-0" />
        </div>

        {/* Plans */}
        <div className="flex flex-col gap-3">
          {subscriptionPlans.map((plan) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              currentPlan={currentPlan}
              onSelect={handleSelectPlan}
            />
          ))}
        </div>

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          Оплата через WayForPay або LiqPay. Скасувати підписку можна у будь-який момент.
        </p>
      </div>

      {/* Confirm modal */}
      <ConfirmModal
        open={!!selectedPlan}
        title={`Підключити тариф ${selectedPlan?.name}?`}
        description={
          selectedPlan?.price === 0
            ? 'Безкоштовний тариф активується одразу.'
            : `Вартість: ${selectedPlan?.price} ${selectedPlan?.currency}/місяць. Ви будете перенаправлені на сторінку оплати.`
        }
        confirmLabel={processing ? 'Обробка...' : selectedPlan?.price === 0 ? 'Активувати' : 'Перейти до оплати'}
        cancelLabel="Скасувати"
        onConfirm={handleCheckout}
        onCancel={() => { setSelectedPlan(null); haptic.light(); }}
      />
    </div>
  );
}
