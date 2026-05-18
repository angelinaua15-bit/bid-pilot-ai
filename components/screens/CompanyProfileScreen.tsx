'use client';

import { useEffect, useState } from 'react';
import {
  Building2, Globe, Mail, Send, Plus, Trash2,
  Save, ChevronRight, ExternalLink, Sparkles,
} from 'lucide-react';
import { haptic, openExternalLink } from '@/lib/telegram';
import { LoadingState } from '@/components/shared/LoadingState';
import { companyProfile as defaultProfile } from '@/lib/mock-data';
import type { CompanyProfile, PortfolioItem, FreelancerCategory, ProposalTone } from '@/types';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<FreelancerCategory, string> = {
  websites:      'Сайти',
  shops:         'Магазини',
  telegram_bots: 'Telegram-боти',
  ai_agents:     'AI-агенти',
  automation:    'Автоматизація',
  seo:           'SEO',
  google_ads:    'Google Ads',
  smm:           'SMM',
  design:        'Дизайн',
  copywriting:   'Копірайтинг',
};
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as FreelancerCategory[];

const TONE_OPTIONS: { value: ProposalTone; label: string; desc: string }[] = [
  { value: 'professional', label: 'Офіційний',    desc: 'Діловий, структурований стиль' },
  { value: 'friendly',     label: 'Дружній',      desc: 'Тепло, але компетентно' },
  { value: 'short',        label: 'Короткий',     desc: 'Лаконічно, по суті' },
  { value: 'detailed',     label: 'Детальний',    desc: 'З розбором та аргументами' },
  { value: 'creative',     label: 'Креативний',   desc: 'Нестандартний підхід' },
];

const LANG_OPTIONS: { value: 'uk' | 'ru' | 'en'; label: string }[] = [
  { value: 'uk', label: 'Українська' },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

export function CompanyProfileScreen() {
  const [profile, setProfile] = useState<CompanyProfile>(defaultProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // New portfolio item form
  const [newItem, setNewItem] = useState<Partial<PortfolioItem>>({});
  const [addingPortfolio, setAddingPortfolio] = useState(false);

  useEffect(() => {
    fetch('/api/company-profile')
      .then((r) => r.json())
      .then((r) => { if (r.ok) setProfile(r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleService = (cat: FreelancerCategory) => {
    const current = profile.services as FreelancerCategory[];
    update(
      'services',
      current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat]
    );
  };

  const handleAddPortfolio = () => {
    if (!newItem.title?.trim()) return;
    const item: PortfolioItem = {
      id: `p_${Date.now()}`,
      title: newItem.title.trim(),
      description: newItem.description?.trim() ?? '',
      url: newItem.url?.trim(),
      tags: [],
    };
    update('portfolio', [...profile.portfolio, item]);
    setNewItem({});
    setAddingPortfolio(false);
    haptic.success();
  };

  const handleRemovePortfolio = (id: string) => {
    haptic.medium();
    update('portfolio', profile.portfolio.filter((p) => p.id !== id));
  };

  const handleSave = async () => {
    haptic.medium();
    setSaving(true);
    try {
      await fetch('/api/company-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      haptic.success();
      setSaved(true);
    } catch {
      haptic.error();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="px-4 pt-4 pb-nav"><LoadingState rows={4} /></div>;

  return (
    <div className="flex flex-col pb-nav px-4 pt-4 gap-4 fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
          <Building2 size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Профіль компанії</h1>
          <p className="text-xs text-muted-foreground">Дані для AI-генерації заявок</p>
        </div>
      </div>

      {/* Basic info */}
      <div className="glass-card rounded-2xl p-4 flex flex-col gap-3">
        <p className="field-label">Основне</p>

        <div>
          <label className="field-label">Назва компанії</label>
          <input
            value={profile.name}
            onChange={(e) => update('name', e.target.value)}
            className="tg-input"
            placeholder="King Kong Lab"
          />
        </div>
        <div>
          <label className="field-label">Слоган</label>
          <input
            value={profile.tagline}
            onChange={(e) => update('tagline', e.target.value)}
            className="tg-input"
            placeholder="Websites. Bots. AI."
          />
        </div>
        <div>
          <label className="field-label">Опис для заявок</label>
          <textarea
            value={profile.description}
            onChange={(e) => update('description', e.target.value)}
            rows={4}
            className="tg-input resize-none"
            placeholder="Розкажіть про компанію..."
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            {profile.description.length} / 500 символів
          </p>
        </div>
      </div>

      {/* Services */}
      <div className="glass-card rounded-2xl p-4 flex flex-col gap-3">
        <p className="field-label">Послуги</p>
        <div className="flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => { haptic.light(); toggleService(cat); }}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                (profile.services as FreelancerCategory[]).includes(cat)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Bid style + language */}
      <div className="glass-card rounded-2xl p-4 flex flex-col gap-3">
        <div>
          <p className="field-label mb-2">Стиль заявок</p>
          <div className="flex flex-col gap-1.5">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { haptic.light(); update('bidStyle', opt.value); }}
                className={cn(
                  'flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all',
                  profile.bidStyle === opt.value
                    ? 'bg-primary/15 border border-primary/40'
                    : 'bg-secondary border border-transparent'
                )}
              >
                <div>
                  <p className={cn('text-sm font-medium', profile.bidStyle === opt.value && 'text-primary')}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                </div>
                {profile.bidStyle === opt.value && (
                  <Sparkles size={14} className="text-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label mb-2">Мова заявок</p>
          <div className="flex gap-2">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { haptic.light(); update('language', opt.value); }}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-semibold transition-all',
                  profile.language === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Contacts */}
      <div className="glass-card rounded-2xl p-4 flex flex-col gap-3">
        <p className="field-label">Контакти</p>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <Send size={14} className="text-muted-foreground" />
          </div>
          <input
            value={profile.contacts.telegram ?? ''}
            onChange={(e) => update('contacts', { ...profile.contacts, telegram: e.target.value })}
            className="tg-input flex-1"
            placeholder="@username"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <Mail size={14} className="text-muted-foreground" />
          </div>
          <input
            value={profile.contacts.email ?? ''}
            onChange={(e) => update('contacts', { ...profile.contacts, email: e.target.value })}
            className="tg-input flex-1"
            placeholder="hello@company.com"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <Globe size={14} className="text-muted-foreground" />
          </div>
          <input
            value={profile.contacts.website ?? ''}
            onChange={(e) => update('contacts', { ...profile.contacts, website: e.target.value })}
            className="tg-input flex-1"
            placeholder="https://yoursite.com"
          />
        </div>
      </div>

      {/* Portfolio */}
      <div className="glass-card rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="field-label">Портфоліо</p>
          <button
            onClick={() => { haptic.light(); setAddingPortfolio((v) => !v); }}
            className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-primary"
          >
            <Plus size={14} />
          </button>
        </div>

        {addingPortfolio && (
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-secondary/50 border border-border">
            <input
              value={newItem.title ?? ''}
              onChange={(e) => setNewItem((v) => ({ ...v, title: e.target.value }))}
              className="tg-input text-sm"
              placeholder="Назва кейсу *"
            />
            <textarea
              value={newItem.description ?? ''}
              onChange={(e) => setNewItem((v) => ({ ...v, description: e.target.value }))}
              className="tg-input text-sm resize-none"
              rows={2}
              placeholder="Короткий опис результату..."
            />
            <input
              value={newItem.url ?? ''}
              onChange={(e) => setNewItem((v) => ({ ...v, url: e.target.value }))}
              className="tg-input text-sm"
              placeholder="https://... (необов'язково)"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddPortfolio}
                disabled={!newItem.title?.trim()}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
              >
                Додати
              </button>
              <button
                onClick={() => { setAddingPortfolio(false); setNewItem({}); }}
                className="px-4 py-2 rounded-xl bg-secondary text-muted-foreground text-xs"
              >
                Скасувати
              </button>
            </div>
          </div>
        )}

        {profile.portfolio.length === 0 && !addingPortfolio && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Додайте кейси — AI використовуватиме їх у заявках
          </p>
        )}

        {profile.portfolio.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50 border border-border"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
              )}
              {item.url && (
                <button
                  onClick={() => openExternalLink(item.url!)}
                  className="flex items-center gap-1 text-[11px] text-primary mt-1"
                >
                  <ExternalLink size={10} /> {item.url}
                </button>
              )}
            </div>
            <button
              onClick={() => handleRemovePortfolio(item.id)}
              className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 flex-shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 brand-glow disabled:opacity-50 transition-all active:scale-95"
      >
        <Save size={16} />
        {saving ? 'Збереження...' : saved ? 'Збережено' : 'Зберегти профіль'}
      </button>
    </div>
  );
}
