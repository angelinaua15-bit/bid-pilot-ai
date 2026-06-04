'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Send, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { haptic, showMainButton, hideMainButton } from '@/lib/telegram';
import { BidPreview } from '@/components/shared/BidPreview';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { EmptyState } from '@/components/shared/EmptyState';
import { mockProjects, mockUser } from '@/lib/mock-data';
import type { GeneratedBid, Project } from '@/types';
import { cn } from '@/lib/utils';

interface AiBidScreenProps {
  preselectedProject?: Project | null;
}

export function AiBidScreen({ preselectedProject }: AiBidScreenProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    preselectedProject?.id ?? ''
  );
  const [notes, setNotes] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customDeadline, setCustomDeadline] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatedBid, setGeneratedBid] = useState<GeneratedBid | null>(null);
  const [editedText, setEditedText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedProject = mockProjects.find((p) => p.id === selectedProjectId);

  // Telegram MainButton for send
  useEffect(() => {
    if (!generatedBid) return;
    const handler = () => setShowConfirm(true);
    showMainButton('Відправити заявку', handler);
    return () => hideMainButton(handler);
  }, [generatedBid]);

  const handleGenerate = async () => {
    if (!selectedProjectId) return;
    haptic.medium();
    setGenerating(true);
    setGeneratedBid(null);

    try {
      const res = await fetch('/api/generate-bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          additionalNotes: notes,
          customPrice: customPrice ? Number(customPrice) : undefined,
          customDeadline: customDeadline || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setGeneratedBid(json.data);
        setEditedText(json.data.text);
        haptic.success();
      } else {
        haptic.error();
      }
    } catch {
      haptic.error();
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!generatedBid) return;
    haptic.medium();
    setSending(true);
    setShowConfirm(false);

    try {
      await fetch('/api/send-bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidId: generatedBid.id, text: editedText }),
      });
      haptic.success();
      setGeneratedBid({ ...generatedBid, status: 'sent' });
    } catch {
      haptic.error();
    } finally {
      setSending(false);
    }
  };

  const handleSave = () => {
    // Bid is already persisted on generation via /api/generate-bid.
    // This gives the user haptic confirmation that the displayed bid is saved.
    haptic.success();
  };

  return (
    <div className="flex flex-col h-dvh">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-nav">
        <h1 className="text-xl font-bold mb-4">AI-генератор заявок</h1>

        {/* Project selector */}
        <div className="mb-4">
          <label className="field-label">Проєкт</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="tg-input"
          >
            <option value="">Оберіть проєкт...</option>
            {mockProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {/* Selected project preview */}
        {selectedProject && (
          <div className="glass-card rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                {selectedProject.category}
              </span>
              <span className="text-xs font-semibold">
                ${selectedProject.budget}–${selectedProject.budgetMax ?? selectedProject.budget}
              </span>
            </div>
            <p className="text-sm font-semibold mb-1">{selectedProject.title}</p>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {selectedProject.description}
            </p>
          </div>
        )}

        {/* Tone selector */}
        <div className="mb-4">
          <label className="field-label">Тон заявки</label>
          <div className="flex gap-2 flex-wrap">
            {['expert', 'short', 'friendly', 'premium'].map((t) => {
              const labels: Record<string, string> = {
                expert: 'Експертно',
                short: 'Коротко',
                friendly: 'Дружньо',
                premium: 'Преміально',
              };
              const profile = mockUser.profile!;
              return (
                <button
                  key={t}
                  onClick={() => haptic.select()}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                    profile.tone === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Additional settings toggle */}
        <button
          onClick={() => { haptic.light(); setShowExtra((v) => !v); }}
          className="flex items-center gap-2 text-sm text-muted-foreground font-medium mb-4"
        >
          {showExtra ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Додаткові параметри
        </button>

        {showExtra && (
          <div className="flex flex-col gap-3 mb-4 fade-in">
            <div>
              <label className="field-label">Бажана ціна (USD)</label>
              <input
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder="Автоматично"
                className="tg-input"
              />
            </div>
            <div>
              <label className="field-label">Бажаний дедлайн</label>
              <input
                type="text"
                value={customDeadline}
                onChange={(e) => setCustomDeadline(e.target.value)}
                placeholder="Автоматично (напр. 14 днів)"
                className="tg-input"
              />
            </div>
            <div>
              <label className="field-label">Нотатки для AI</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Що підкреслити у заявці..."
                rows={3}
                className="tg-input resize-none"
              />
            </div>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!selectedProjectId || generating}
          className={cn(
            'w-full py-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 mb-5',
            selectedProjectId && !generating
              ? 'bg-primary text-primary-foreground brand-glow'
              : 'bg-secondary text-muted-foreground cursor-not-allowed'
          )}
        >
          {generating ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              AI генерує заявку...
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Згенерувати заявку
            </>
          )}
        </button>

        {/* Generated result */}
        {!generating && !generatedBid && !selectedProjectId && (
          <EmptyState
            icon={<Sparkles size={24} />}
            title="Оберіть проєкт"
            description="Виберіть проєкт зі списку та натисніть «Згенерувати заявку»"
          />
        )}

        {generating && (
          <div className="glass-card rounded-2xl p-6 flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center">
              <Sparkles size={24} className="text-primary animate-pulse" />
            </div>
            <p className="text-sm font-semibold">AI аналізує проєкт...</p>
            <p className="text-xs text-muted-foreground text-center">
              Генеруємо персоналізовану заявку на основі вашого профілю
            </p>
          </div>
        )}

        {generatedBid && !generating && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Результат</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setIsEditing((v) => !v); haptic.light(); }}
                  className="text-xs text-primary font-medium"
                >
                  {isEditing ? 'Зберегти ред.' : 'Редагувати'}
                </button>
                <button
                  onClick={handleGenerate}
                  className="text-xs text-muted-foreground font-medium flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Ще раз
                </button>
              </div>
            </div>
            <BidPreview
              bid={{ ...generatedBid, text: editedText }}
              editable={isEditing}
              onTextChange={setEditedText}
            />

            {/* Action buttons (fallback for non-Telegram or when MainButton not available) */}
            <div className="flex gap-2 pb-2">
              <button
                onClick={handleSave}
                className="flex-1 py-3 rounded-2xl bg-secondary text-secondary-foreground text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Save size={16} />
                Зберегти
              </button>
              <button
                onClick={() => { haptic.medium(); setShowConfirm(true); }}
                disabled={sending || generatedBid.status === 'sent'}
                className={cn(
                  'flex-1 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all',
                  generatedBid.status === 'sent'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-primary text-primary-foreground brand-glow active:scale-95'
                )}
              >
                <Send size={16} />
                {generatedBid.status === 'sent' ? 'Відправлено' : 'Відправити'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      <ConfirmModal
        open={showConfirm}
        title="Відправити заявку?"
        description={`Заявка буде відправлена на проєкт "${selectedProject?.title}". Ця дія незворотна.`}
        confirmLabel="Так, відправити"
        cancelLabel="Скасувати"
        onConfirm={handleSend}
        onCancel={() => { setShowConfirm(false); haptic.light(); }}
      />
    </div>
  );
}
