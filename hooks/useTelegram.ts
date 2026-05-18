'use client';

/**
 * hooks/useTelegram.ts
 * React hook for Telegram Mini App integration.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  getWebApp,
  getTelegramUser,
  initTelegram,
  isTelegram,
  showBackButton,
  hideBackButton,
  showMainButton,
  hideMainButton,
  setMainButtonLoading,
  haptic,
} from '@/lib/telegram';
import type { TelegramUser } from '@/types';
import { mockTelegramUser } from '@/lib/mock-data';

export function useTelegram() {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTelegramEnv, setIsTelegramEnv] = useState(false);

  useEffect(() => {
    initTelegram();
    const inTelegram = isTelegram();
    setIsTelegramEnv(inTelegram);

    const telegramUser = getTelegramUser();
    // Use real user in Telegram, mock user in browser
    setUser(inTelegram ? telegramUser : mockTelegramUser);
    setIsReady(true);
  }, []);

  const useBackButton = useCallback((handler: () => void, active: boolean) => {
    useEffect(() => {
      if (!active) return;
      showBackButton(handler);
      return () => hideBackButton(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);
  }, []);

  const useMainBtn = useCallback(
    (text: string, handler: () => void, active: boolean, loading?: boolean) => {
      useEffect(() => {
        if (!active) {
          hideMainButton(handler);
          return;
        }
        showMainButton(text, handler);
        return () => hideMainButton(handler);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [active, text]);

      useEffect(() => {
        if (active) setMainButtonLoading(!!loading);
      }, [loading, active]);
    },
    []
  );

  const webApp = getWebApp();

  return {
    user,
    isReady,
    isTelegramEnv,
    webApp,
    haptic,
    showBackButton,
    hideBackButton,
    showMainButton,
    hideMainButton,
    useBackButton,
    useMainBtn,
  };
}
