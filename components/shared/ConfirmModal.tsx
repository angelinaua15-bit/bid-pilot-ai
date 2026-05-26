'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Підтвердити',
  cancelLabel = 'Скасувати',
  destructive,
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  if (!open) return null;

  const handleConfirm = () => {
    haptic.medium();
    onConfirm();
  };

  const handleCancel = () => {
    haptic.light();
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleCancel}
      />
      <div className="relative w-full max-w-md glass-card rounded-t-3xl rounded-b-none p-6 pb-8 fade-in border-t border-border">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />
        <h3 className="text-lg font-bold mb-2 text-balance">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
        )}
        {children}
        <div className="flex flex-col gap-3 mt-5">
          <button
            onClick={handleConfirm}
            className={cn(
              'w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95',
              destructive
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-primary text-primary-foreground brand-glow'
            )}
          >
            {confirmLabel}
          </button>
          <button
            onClick={handleCancel}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm bg-secondary text-secondary-foreground transition-all active:scale-95"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
