import { Check, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SubscriptionPlan, PlanId } from '@/types';

interface PricingCardProps {
  plan: SubscriptionPlan;
  currentPlan?: PlanId;
  onSelect: (plan: SubscriptionPlan) => void;
}

export function PricingCard({ plan, currentPlan, onSelect }: PricingCardProps) {
  const isCurrent = plan.id === currentPlan;
  const isRecommended = plan.recommended;

  return (
    <div
      className={cn(
        'glass-card rounded-2xl p-4 flex flex-col gap-3 transition-all',
        isCurrent && 'border-primary/50 bg-primary/5',
        isRecommended && !isCurrent && 'border-yellow-500/30'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRecommended && <Crown size={14} className="text-yellow-400" />}
          <h3 className="text-base font-bold">{plan.name}</h3>
        </div>
        <div className="flex items-baseline gap-0.5">
          <span className="text-xl font-bold">{plan.price === 0 ? 'Безкоштовно' : plan.price}</span>
          {plan.price > 0 && (
            <span className="text-xs text-muted-foreground"> {plan.currency}/міс</span>
          )}
        </div>
      </div>

      {/* Features */}
      <ul className="flex flex-col gap-1.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check size={13} className="text-primary flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={() => onSelect(plan)}
        disabled={isCurrent}
        className={cn(
          'w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-95',
          isCurrent
            ? 'bg-primary/20 text-primary cursor-default'
            : isRecommended
            ? 'bg-primary text-primary-foreground brand-glow'
            : 'bg-secondary text-secondary-foreground'
        )}
      >
        {isCurrent ? 'Поточний тариф' : 'Обрати тариф'}
      </button>
    </div>
  );
}
