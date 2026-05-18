'use client';

import { Copy, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { haptic } from '@/lib/telegram';
import type { GeneratedBid } from '@/types';

interface BidPreviewProps {
  bid: GeneratedBid;
  editable?: boolean;
  onTextChange?: (text: string) => void;
}

export function BidPreview({ bid, editable, onTextChange }: BidPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    haptic.light();
    try {
      await navigator.clipboard.writeText(bid.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for Telegram WebApp
      const el = document.createElement('textarea');
      el.value = bid.text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Текст заявки
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-primary font-medium"
        >
          {copied ? <CheckCheck size={13} className="text-green-400" /> : <Copy size={13} />}
          {copied ? 'Скопійовано' : 'Копіювати'}
        </button>
      </div>

      {/* Text */}
      <div className="p-4">
        {editable ? (
          <textarea
            value={bid.text}
            onChange={(e) => onTextChange?.(e.target.value)}
            rows={6}
            className="w-full bg-transparent text-sm leading-relaxed text-foreground resize-none outline-none"
          />
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{bid.text}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 flex flex-wrap gap-3">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Бюджет</span>
          <span className="text-sm font-bold">${bid.price}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Дедлайн</span>
          <span className="text-sm font-bold">{bid.deadline}</span>
        </div>
      </div>

      {/* Questions */}
      {bid.questions.length > 0 && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
            Уточнюючі питання
          </p>
          <ul className="flex flex-col gap-1.5">
            {bid.questions.map((q, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary font-bold flex-shrink-0">{i + 1}.</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
