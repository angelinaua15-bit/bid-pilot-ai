'use client';

import { useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';
import type { ProposalTone, FreelancerCategory } from '@/types';

const CATEGORIES: { id: FreelancerCategory; label: string }[] = [
  { id: 'websites',      label: 'Веб-сайти' },
  { id: 'shops',         label: 'Інтернет-магазини' },
  { id: 'telegram_bots', label: 'Telegram-боти' },
  { id: 'ai_agents',     label: 'AI-агенти' },
  { id: 'automation',    label: 'Автоматизація' },
  { id: 'seo',           label: 'SEO' },
  { id: 'google_ads',    label: 'Google Ads' },
  { id: 'smm',           label: 'SMM' },
  { id: 'design',        label: 'Дизайн' },
  { id: 'copywriting',   label: 'Копірайтинг' },
];

const TONES: { id: ProposalTone; label: string; desc: string }[] = [
  { id: 'short',    label: 'Коротко і по суті', desc: 'Без зайвого, лише факти' },
  { id: 'expert',   label: 'Експертно',          desc: 'Демонструє глибоку компетентність' },
  { id: 'friendly', label: 'Дружньо',            desc: 'Людяний та відкритий стиль' },
  { id: 'premium',  label: 'Преміально',         desc: 'Для топ-клієнтів' },
];

interface ProfileSetupScreenProps {
  onComplete: () => void;
}

export function ProfileSetupScreen({ onComplete }: ProfileSetupScreenProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [services, setServices] = useState('');
  const [experience, setExperience] = useState('');
  const [portfolioLinks, setPortfolioLinks] = useState<string[]>(['']);
  const [minBudget, setMinBudget] = useState('500');
  const [tone, setTone] = useState<ProposalTone>('expert');
  const [categories, setCategories] = useState<FreelancerCategory[]>([]);
  const [saving, setSaving] = useState(false);

  const steps = [
    'Особисте',
    'Досвід',
    'Параметри',
    'Категорії',
  ];

  const addPortfolioLink = () => setPortfolioLinks((l) => [...l, '']);
  const removePortfolioLink = (i: number) =>
    setPortfolioLinks((l) => l.filter((_, idx) => idx !== i));
  const updatePortfolioLink = (i: number, val: string) =>
    setPortfolioLinks((l) => l.map((v, idx) => (idx === i ? val : v)));

  const toggleCategory = (id: FreelancerCategory) => {
    haptic.select();
    setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const canNext = () => {
    if (step === 0) return name.trim().length > 1 && specialization.trim().length > 1;
    if (step === 1) return experience.trim().length > 10;
    if (step === 2) return !!tone;
    if (step === 3) return categories.length > 0;
    return true;
  };

  const handleNext = async () => {
    haptic.medium();
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    // Final step — save profile
    setSaving(true);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, specialization, services, experience,
          portfolioLinks: portfolioLinks.filter(Boolean),
          minBudget: Number(minBudget), tone, categories,
          language: 'uk',
        }),
      });
      haptic.success();
      onComplete();
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col min-h-dvh fade-in">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-xl font-bold mb-1">Налаштування профілю</h1>
        <p className="text-sm text-muted-foreground">Крок {step + 1} з {steps.length}</p>
        {/* Progress */}
        <div className="flex gap-1.5 mt-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 rounded-full flex-1 transition-all duration-300',
                i <= step ? 'bg-primary' : 'bg-secondary'
              )}
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 pb-28">

        {/* Step 0: Personal */}
        {step === 0 && (
          <div className="flex flex-col gap-4 fade-in">
            <Field label="Ваше ім'я *">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Олексій Ковальчук"
                className="tg-input"
              />
            </Field>
            <Field label="Основна спеціалізація *">
              <input
                type="text"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="Full-stack розробник"
                className="tg-input"
              />
            </Field>
            <Field label="Послуги">
              <textarea
                value={services}
                onChange={(e) => setServices(e.target.value)}
                placeholder="Веб-сайти, Telegram-боти, AI-агенти..."
                rows={3}
                className="tg-input resize-none"
              />
            </Field>
          </div>
        )}

        {/* Step 1: Experience */}
        {step === 1 && (
          <div className="flex flex-col gap-4 fade-in">
            <Field label="Досвід та кейси *">
              <textarea
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="5 років досвіду. Реалізував 80+ проєктів..."
                rows={4}
                className="tg-input resize-none"
              />
            </Field>
            <Field label="Посилання на портфоліо">
              {portfolioLinks.map((link, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="url"
                    value={link}
                    onChange={(e) => updatePortfolioLink(i, e.target.value)}
                    placeholder="https://..."
                    className="tg-input flex-1"
                  />
                  {portfolioLinks.length > 1 && (
                    <button
                      onClick={() => removePortfolioLink(i)}
                      className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addPortfolioLink}
                className="flex items-center gap-2 text-sm text-primary font-medium mt-1"
              >
                <Plus size={16} /> Додати посилання
              </button>
            </Field>
          </div>
        )}

        {/* Step 2: Preferences */}
        {step === 2 && (
          <div className="flex flex-col gap-4 fade-in">
            <Field label="Мінімальний бюджет (USD)">
              <input
                type="number"
                value={minBudget}
                onChange={(e) => setMinBudget(e.target.value)}
                placeholder="500"
                className="tg-input"
              />
            </Field>
            <Field label="Тон заявок">
              <div className="flex flex-col gap-2">
                {TONES.map(({ id, label, desc }) => (
                  <button
                    key={id}
                    onClick={() => { haptic.select(); setTone(id); }}
                    className={cn(
                      'text-left p-4 rounded-2xl border transition-all',
                      tone === id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-secondary/50'
                    )}
                  >
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* Step 3: Categories */}
        {step === 3 && (
          <div className="fade-in">
            <p className="text-sm text-muted-foreground mb-4">
              Оберіть категорії проєктів, які вас цікавлять
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => toggleCategory(id)}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-medium border transition-all active:scale-95',
                    categories.includes(id)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-secondary text-secondary-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 p-5 safe-bottom bg-background/95 border-t border-border">
        <div className="flex gap-3">
          {step > 0 && (
            <button
              onClick={() => { haptic.light(); setStep((s) => s - 1); }}
              className="px-5 py-3.5 rounded-2xl bg-secondary text-secondary-foreground font-semibold text-sm"
            >
              Назад
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={!canNext() || saving}
            className={cn(
              'flex-1 py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-95',
              canNext() && !saving
                ? 'bg-primary text-primary-foreground brand-glow'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {saving ? 'Збереження...' : step === steps.length - 1 ? 'Завершити' : 'Далі'}
            {!saving && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
