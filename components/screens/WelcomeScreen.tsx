'use client';

import { useState } from 'react';
import { Bot, Search, Zap, Rocket, TrendingUp, BarChart3, CheckCircle2, ChevronRight } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';

interface WelcomeScreenProps {
  onStart: () => void;
}

const STEPS = [
  {
    step: 1,
    icon: Bot,
    title: 'Welcome to BidPilot',
    subtitle: 'Your AI co-pilot for freelance success',
    content: null,
    cta: 'Next',
  },
  {
    step: 2,
    icon: Zap,
    title: 'How it works',
    subtitle: 'Three steps, fully automated',
    content: [
      { icon: Search,        label: 'We find projects',              desc: 'Continuous monitoring of Freelancehunt for new relevant projects' },
      { icon: Zap,           label: 'AI generates bids',             desc: 'GPT-4 writes a personalised proposal for each matching project' },
      { icon: Rocket,        label: 'System sends bids automatically', desc: 'Bids go out while you focus on what matters' },
    ],
    cta: 'Next',
  },
  {
    step: 3,
    icon: TrendingUp,
    title: 'What you get',
    subtitle: 'Real business results',
    content: [
      { icon: TrendingUp,    label: 'More leads',                    desc: 'Never miss a relevant project again — 24/7 coverage' },
      { icon: Zap,           label: 'Faster responses',              desc: 'First bid in under 2 minutes beats 90% of competitors' },
      { icon: BarChart3,     label: 'Automated workflow',            desc: 'Set your criteria once, let the system handle the rest' },
    ],
    cta: 'Next',
  },
  {
    step: 4,
    icon: CheckCircle2,
    title: 'Ready to launch',
    subtitle: 'System connected to main account',
    content: null,
    cta: 'Launch System',
  },
];

export function WelcomeScreen({ onStart }: WelcomeScreenProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    haptic.medium();
    if (isLast) {
      onStart();
    } else {
      setStep((s) => s + 1);
    }
  };

  return (
    <div className="flex flex-col h-dvh px-5 pb-10 pt-14 fade-in" key={step}>
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 mb-10">
        {STEPS.map((_, i) => (
          <button
            key={i}
            onClick={() => { haptic.light(); setStep(i); }}
            className={cn(
              'rounded-full transition-all duration-300',
              i === step
                ? 'w-6 h-1.5 bg-primary'
                : i < step
                  ? 'w-1.5 h-1.5 bg-primary/50'
                  : 'w-1.5 h-1.5 bg-border'
            )}
          />
        ))}
      </div>

      {/* Icon */}
      <div className="flex justify-center mb-6">
        <div className={cn(
          'w-20 h-20 rounded-3xl flex items-center justify-center',
          isLast
            ? 'bg-green-500/15 border border-green-500/30'
            : 'bg-primary/15 border border-primary/30 brand-glow'
        )}>
          <Icon size={40} className={isLast ? 'text-green-400' : 'text-primary'} />
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-balance mb-2">
          {current.title}
        </h1>
        <p className="text-sm text-muted-foreground text-balance leading-relaxed">
          {current.subtitle}
        </p>
      </div>

      {/* Step content */}
      {current.content && (
        <div className="flex flex-col gap-3 mb-8">
          {current.content.map(({ icon: ItemIcon, label, desc }, i) => (
            <div key={i} className="glass-card flex items-start gap-4 p-4 rounded-2xl">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ItemIcon size={16} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Step 4 internal-mode card */}
      {isLast && (
        <div className="glass-card p-4 rounded-2xl mb-8 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Internal system</p>
            <p className="text-xs text-muted-foreground">Connected to main account — no login required</p>
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* CTA */}
      <button
        onClick={handleNext}
        className={cn(
          'w-full py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-95',
          isLast
            ? 'bg-green-500 text-white'
            : 'bg-primary text-primary-foreground brand-glow'
        )}
      >
        {current.cta}
        {!isLast && <ChevronRight size={18} />}
      </button>

      {/* Skip */}
      {!isLast && (
        <button
          onClick={() => { haptic.light(); setStep(STEPS.length - 1); }}
          className="mt-4 text-center text-xs text-muted-foreground"
        >
          Skip intro
        </button>
      )}
    </div>
  );
}
