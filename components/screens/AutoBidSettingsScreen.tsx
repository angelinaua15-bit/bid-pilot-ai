'use client';

import { useEffect, useState } from 'react';
import {
  Bot, Shield, Clock, DollarSign, Tag,
  AlertTriangle, Save, RotateCcw, ChevronDown,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { LoadingState } from '@/components/shared/LoadingState';
import { defaultAutoBidSettings } from '@/lib/mock-data';
import type { AutoBidSettings, FreelancerCategory } from '@/types';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<FreelancerCategory, string> = {
  websites:       'Сайти',
  shops:          'Магазини',
  telegram_bots:  'Telegram-боти',
  ai_agents:      'AI-агенти',
  automation:     'Автоматизація',
  seo:            'SEO',
  google_ads:     'Google Ads',
  smm:            'SMM',
  design:         'Дизайн',
  copywriting:    'Копірайтинг',
};
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as FreelancerCategory[];

const DAYS_UA = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

interface SectionProps { title: string; icon: React.ElementType; children: React.ReactNode }
function Section({ title, icon: Icon, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border/50"
      >
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-primary" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 py-3 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

interface RowProps { label: string; sublabel?: string; children: React.ReactNode }
function Row({ label, sublabel, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground">{sublabel}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; danger?: boolean }
function Toggle({ checked, onChange, danger }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-all duration-300',
        checked ? (danger ? 'bg-red-500' : 'bg-primary') : 'bg-secondary'
      )}
    >
      <span className={cn(
        'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300',
        checked ? 'left-5' : 'left-0.5'
      )} />
    </button>
  );
}

export function AutoBidSettingsScreen() {
  const [settings, setSettings] = useState<AutoBidSettings>(defaultAutoBidSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blockedInput, setBlockedInput] = useState('');

  useEffect(() => {
    fetch('/api/auto-bid/settings')
      .then((r) => r.json())
      .then((r) => { if (r.ok) setSettings(r.data); })
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof AutoBidSettings>(key: K, value: AutoBidSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleCategory = (cat: FreelancerCategory) => {
    const current = settings.allowedCategories;
    update('allowedCategories',
      current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat]
    );
  };

  const toggleDay = (day: number) => {
    const current = settings.workingDays;
    update('workingDays',
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    );
  };

  const addBlockedKeyword = () => {
    const kw = blockedInput.trim();
    if (!kw || settings.blockedKeywords.includes(kw)) return;
    update('blockedKeywords', [...settings.blockedKeywords, kw]);
    setBlockedInput('');
  };

  const removeBlockedKeyword = (kw: string) => {
    update('blockedKeywords', settings.blockedKeywords.filter((k) => k !== kw));
  };

  const handleSave = async () => {
    haptic.medium();
    setSaving(true);
    try {
      await fetch('/api/auto-bid/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      haptic.success();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    haptic.medium();
    setSettings(defaultAutoBidSettings);
    setSaved(false);
  };

  if (loading) return <div className="px-4 pt-4 pb-nav"><LoadingState rows={4} /></div>;

  return (
    <div className="flex flex-col pb-nav px-4 pt-4 gap-4 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Налаштування Auto-Bid</h1>
        <button onClick={handleReset} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground">
          <RotateCcw size={15} />
        </button>
      </div>

      {/* Emergency stop banner */}
      {settings.emergencyStop && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400 flex-1">Аварійна зупинка активована. Відключіть щоб відновити роботу.</p>
          <button
            onClick={() => update('emergencyStop', false)}
            className="text-xs text-red-400 font-semibold underline"
          >
            Скасувати
          </button>
        </div>
      )}

      {/* Main toggle */}
      <Section title="Основне" icon={Bot}>
        <Row label="Auto-Bid увімкнено" sublabel="Автоматично відповідати на нові проєкти">
          <Toggle checked={settings.enabled} onChange={(v) => update('enabled', v)} />
        </Row>
        <Row label="Денний ліміт заявок" sublabel={`Поточне: ${settings.dailyLimit}`}>
          <input
            type="number"
            min={1} max={100}
            value={settings.dailyLimit}
            onChange={(e) => update('dailyLimit', Number(e.target.value))}
            className="w-16 text-center tg-input py-2 text-sm"
          />
        </Row>
      </Section>

      {/* Budget */}
      <Section title="Бюджет" icon={DollarSign}>
        <Row label="Мін. бюджет ($)" sublabel="Проєкти нижче цієї суми пропускаються">
          <input
            type="number" min={0}
            value={settings.minBudget}
            onChange={(e) => update('minBudget', Number(e.target.value))}
            className="w-20 text-center tg-input py-2 text-sm"
          />
        </Row>
        <Row label="Макс. бюджет ($)" sublabel="0 = без обмежень">
          <input
            type="number" min={0}
            value={settings.maxBudget}
            onChange={(e) => update('maxBudget', Number(e.target.value))}
            className="w-20 text-center tg-input py-2 text-sm"
          />
        </Row>
        <Row label="Мін. match score" sublabel={`Зараз: ${settings.minMatchScore}%`}>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100}
              value={settings.minMatchScore}
              onChange={(e) => update('minMatchScore', Number(e.target.value))}
              className="w-20 accent-primary"
            />
            <span className="text-sm font-semibold w-8 text-right">{settings.minMatchScore}</span>
          </div>
        </Row>
      </Section>

      {/* Categories */}
      <Section title="Категорії" icon={Tag}>
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { haptic.light(); toggleCategory(cat); }}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                settings.allowedCategories.includes(cat)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </Section>

      {/* Blocked keywords */}
      <Section title="Заблоковані слова" icon={Shield}>
        <div className="flex gap-2">
          <input
            value={blockedInput}
            onChange={(e) => setBlockedInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addBlockedKeyword()}
            placeholder="Додати слово..."
            className="tg-input flex-1 py-2 text-sm"
          />
          <button
            onClick={addBlockedKeyword}
            className="px-3 py-2 rounded-xl bg-secondary text-sm font-medium"
          >
            +
          </button>
        </div>
        {settings.blockedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {settings.blockedKeywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-secondary text-xs">
                {kw}
                <button onClick={() => removeBlockedKeyword(kw)} className="text-muted-foreground ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Timing */}
      <Section title="Розклад і затримки" icon={Clock}>
        <Row label="Затримка між заявками" sublabel="Секунди (мін / макс)">
          <div className="flex items-center gap-1.5">
            <input type="number" min={10}
              value={settings.delayBetweenBidsMin}
              onChange={(e) => update('delayBetweenBidsMin', Number(e.target.value))}
              className="w-14 text-center tg-input py-2 text-xs"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input type="number" min={10}
              value={settings.delayBetweenBidsMax}
              onChange={(e) => update('delayBetweenBidsMax', Number(e.target.value))}
              className="w-14 text-center tg-input py-2 text-xs"
            />
          </div>
        </Row>
        <Row label="Робочі години" sublabel="За київським часом (UTC+2)">
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} max={23}
              value={settings.workingHoursStart}
              onChange={(e) => update('workingHoursStart', Number(e.target.value))}
              className="w-12 text-center tg-input py-2 text-xs"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input type="number" min={0} max={23}
              value={settings.workingHoursEnd}
              onChange={(e) => update('workingHoursEnd', Number(e.target.value))}
              className="w-12 text-center tg-input py-2 text-xs"
            />
          </div>
        </Row>
        <div>
          <p className="field-label mb-2">Робочі дні</p>
          <div className="flex gap-1.5">
            {DAYS_UA.map((label, i) => (
              <button
                key={i}
                onClick={() => { haptic.light(); toggleDay(i); }}
                className={cn(
                  'flex-1 py-1.5 rounded-xl text-xs font-medium transition-all',
                  settings.workingDays.includes(i)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Emergency stop */}
      <Section title="Безпека" icon={AlertTriangle}>
        <Row label="Аварійна зупинка" sublabel="Негайно зупинити всі операції">
          <Toggle checked={settings.emergencyStop} onChange={(v) => update('emergencyStop', v)} danger />
        </Row>
      </Section>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 brand-glow disabled:opacity-50 transition-all active:scale-95"
      >
        <Save size={16} />
        {saving ? 'Збереження...' : saved ? 'Збережено' : 'Зберегти налаштування'}
      </button>
    </div>
  );
}
