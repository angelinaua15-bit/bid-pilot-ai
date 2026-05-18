'use client';

import { useEffect, useState } from 'react';
import { TelegramProvider, useTelegramContext } from '@/components/providers/TelegramProvider';
import { BottomNavigation } from '@/components/shared/BottomNavigation';
import { WelcomeScreen } from '@/components/screens/WelcomeScreen';
import { DashboardScreen } from '@/components/screens/DashboardScreen';
import { ProjectsScreen } from '@/components/screens/ProjectsScreen';
import { AutoBidSettingsScreen } from '@/components/screens/AutoBidSettingsScreen';
import { LogsScreen } from '@/components/screens/LogsScreen';
import { HistoryScreen } from '@/components/screens/HistoryScreen';
import type { NavTab } from '@/types';

// ── App shell ────────────────────────────────────────────────────────────────
function AppShell() {
  const { isReady, isTelegramEnv } = useTelegramContext();

  const [onboardDone, setOnboardDone] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('home');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('bidpilot_onboard_done') === '1') {
      setOnboardDone(true);
    }
  }, []);

  const completeOnboard = () => {
    localStorage.setItem('bidpilot_onboard_done', '1');
    setOnboardDone(true);
  };

  const showBrowserBanner = isReady && !isTelegramEnv;

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-xs text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Onboarding ──────────────────────────────────────────────────────────────
  if (!onboardDone) {
    return (
      <div className="h-dvh overflow-hidden bg-background">
        {showBrowserBanner && <BrowserBanner />}
        <WelcomeScreen onStart={completeOnboard} />
      </div>
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh bg-background flex flex-col overflow-hidden">
      {showBrowserBanner && <BrowserBanner />}

      <main className="flex-1 overflow-hidden" style={{ paddingTop: 'var(--tg-safe-top, 0px)' }}>
        {activeTab === 'home' && (
          <div className="h-full overflow-y-auto fade-in">
            <DashboardScreen onNavigate={setActiveTab} />
          </div>
        )}
        {activeTab === 'projects' && (
          <div className="h-full fade-in">
            <ProjectsScreen onNavigate={setActiveTab} />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="h-full overflow-y-auto fade-in">
            <AutoBidSettingsScreen />
          </div>
        )}
        {activeTab === 'logs' && (
          <div className="h-full fade-in">
            <LogsScreen />
          </div>
        )}
        {activeTab === 'history' && (
          <div className="h-full fade-in">
            <HistoryScreen />
          </div>
        )}
      </main>

      <BottomNavigation active={activeTab} onChange={setActiveTab} />
    </div>
  );
}

// ── Browser-mode informational banner ─────────────────────────────────────────
function BrowserBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-400 text-xs">
      <span className="font-semibold flex-1">
        Browser preview mode — open in Telegram for full experience
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="text-yellow-400/60 hover:text-yellow-400 font-bold"
      >
        ×
      </button>
    </div>
  );
}

// ── Root page ──────────────────────────────────────────────────────────────────
export default function Page() {
  return (
    <TelegramProvider>
      <AppShell />
    </TelegramProvider>
  );
}
