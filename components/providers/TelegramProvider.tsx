'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { initTelegram, getTelegramUser, isTelegram } from '@/lib/telegram';
import { mockTelegramUser } from '@/lib/mock-data';
import type { TelegramUser } from '@/types';

interface TelegramContextValue {
  user: TelegramUser | null;
  isReady: boolean;
  isTelegramEnv: boolean;
}

const TelegramContext = createContext<TelegramContextValue>({
  user: null,
  isReady: false,
  isTelegramEnv: false,
});

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTelegramEnv, setIsTelegramEnv] = useState(false);

  useEffect(() => {
    initTelegram();
    const inTg = isTelegram();
    setIsTelegramEnv(inTg);
    const tgUser = getTelegramUser();
    setUser(inTg ? tgUser : mockTelegramUser);
    setIsReady(true);
  }, []);

  return (
    <TelegramContext.Provider value={{ user, isReady, isTelegramEnv }}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegramContext() {
  return useContext(TelegramContext);
}
