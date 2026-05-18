'use client';

import { Info } from 'lucide-react';
import { useTelegramContext } from '@/components/providers/TelegramProvider';

export function BrowserFallback() {
  const { isTelegramEnv, isReady } = useTelegramContext();

  if (!isReady || isTelegramEnv) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-secondary border-b border-border text-xs text-muted-foreground">
      <Info size={13} className="flex-shrink-0 text-primary" />
      <span>
        Режим браузера — увійдіть через Telegram для повного доступу. Використовуються тестові дані.
      </span>
    </div>
  );
}
