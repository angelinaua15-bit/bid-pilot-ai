/**
 * lib/telegram.ts
 * Telegram Mini App SDK helpers.
 *
 * All WebApp calls are safely guarded so the app runs in a browser
 * during development / preview without crashing.
 */

import type { TelegramUser } from '@/types';

// ─── Type declarations ────────────────────────────────────────────────────────

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;

  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    auth_date?: number;
    hash?: string;
    chat_instance?: string;
    chat_type?: string;
  };

  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  platform: string;
  version: string;

  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (fn: () => void) => void;
    offClick: (fn: () => void) => void;
  };

  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    setText: (text: string) => void;
    onClick: (fn: () => void) => void;
    offClick: (fn: () => void) => void;
    setParams: (params: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }) => void;
  };

  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };

  safeAreaInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  contentSafeAreaInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  onEvent: (event: string, fn: () => void) => void;
  offEvent: (event: string, fn: () => void) => void;
  sendData: (data: string) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback: (ok: boolean) => void) => void;
  showPopup: (params: {
    title?: string;
    message: string;
    buttons?: Array<{
      id?: string;
      type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
      text?: string;
    }>;
  }, callback?: (buttonId: string) => void) => void;
  requestWriteAccess: (callback?: (granted: boolean) => void) => void;
  requestContact: (callback?: (sent: boolean) => void) => void;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function isTelegram(): boolean {
  const wa = getWebApp();
  return !!(wa && wa.initData);
}

/** Call once on app mount */
export function initTelegram(): void {
  const wa = getWebApp();
  if (!wa) return;
  wa.ready();
  wa.expand();

  // Defer CSS variable writes until after React hydration to avoid mismatch
  setTimeout(() => {
    const insets = wa.safeAreaInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
    document.documentElement.style.setProperty('--tg-safe-top', `${insets.top}px`);
    document.documentElement.style.setProperty('--tg-safe-bottom', `${insets.bottom}px`);

    // Keep viewport height in sync with Telegram's dynamic viewport
    const updateViewportHeight = () => {
      const vh = wa.viewportStableHeight ?? window.innerHeight;
      document.documentElement.style.setProperty('--tg-viewport-height', `${vh}px`);
    };
    updateViewportHeight();
    wa.onEvent('viewportChanged', updateViewportHeight);
  }, 0);
}

export function getTelegramUser(): TelegramUser | null {
  return getWebApp()?.initDataUnsafe?.user ?? null;
}

export function getTelegramInitData(): string {
  return getWebApp()?.initData ?? '';
}

// ─── Back Button ─────────────────────────────────────────────────────────────

export function showBackButton(handler: () => void): void {
  const wa = getWebApp();
  if (!wa) return;
  wa.BackButton.onClick(handler);
  wa.BackButton.show();
}

export function hideBackButton(handler?: () => void): void {
  const wa = getWebApp();
  if (!wa) return;
  if (handler) wa.BackButton.offClick(handler);
  wa.BackButton.hide();
}

// ─── Main Button ─────────────────────────────────────────────────────────────

export function showMainButton(text: string, handler: () => void, color = '#0027EE'): void {
  const wa = getWebApp();
  if (!wa) return;
  wa.MainButton.setParams({
    text,
    color,
    text_color: '#FFFFFF',
    is_visible: true,
    is_active: true,
  });
  wa.MainButton.onClick(handler);
  wa.MainButton.show();
}

export function hideMainButton(handler?: () => void): void {
  const wa = getWebApp();
  if (!wa) return;
  if (handler) wa.MainButton.offClick(handler);
  wa.MainButton.hide();
}

export function setMainButtonLoading(loading: boolean): void {
  const wa = getWebApp();
  if (!wa) return;
  if (loading) {
    wa.MainButton.showProgress(false);
    wa.MainButton.disable();
  } else {
    wa.MainButton.hideProgress();
    wa.MainButton.enable();
  }
}

// ─── Haptic Feedback ─────────────────────────────────────────────────────────

export const haptic = {
  light:   () => getWebApp()?.HapticFeedback.impactOccurred('light'),
  medium:  () => getWebApp()?.HapticFeedback.impactOccurred('medium'),
  heavy:   () => getWebApp()?.HapticFeedback.impactOccurred('heavy'),
  success: () => getWebApp()?.HapticFeedback.notificationOccurred('success'),
  error:   () => getWebApp()?.HapticFeedback.notificationOccurred('error'),
  warning: () => getWebApp()?.HapticFeedback.notificationOccurred('warning'),
  select:  () => getWebApp()?.HapticFeedback.selectionChanged(),
};

// ─── Utility ─────────────────────────────────────────────────────────────────

export function openExternalLink(url: string): void {
  const wa = getWebApp();
  if (wa) {
    wa.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

export function showTelegramAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (wa) {
      wa.showAlert(message, resolve);
    } else {
      alert(message);
      resolve();
    }
  });
}

export function showTelegramConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (wa) {
      wa.showConfirm(message, resolve);
    } else {
      resolve(confirm(message));
    }
  });
}