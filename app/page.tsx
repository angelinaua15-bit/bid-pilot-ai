'use client';

import { useEffect, useState, useCallback } from 'react';
import { TelegramProvider, useTelegramContext } from '@/components/providers/TelegramProvider';
import { BottomNavigation } from '@/components/shared/BottomNavigation';
import { DashboardScreen } from '@/components/screens/DashboardScreen';
import { FreelanceScreen } from '@/components/screens/FreelanceScreen';
import { CampaignsScreen } from '@/components/screens/CampaignsScreen';
import { LogsScreen } from '@/components/screens/LogsScreen';
import { AccountScreen } from '@/components/screens/AccountScreen';
import { AdminScreen } from '@/components/screens/AdminScreen';
import type { NavTab, SaaSUser } from '@/types';

// ── App shell ────────────────────────────────────────────────────────────────
function AppShell() {
  const { isReady, isTelegramEnv, user: tgUser } = useTelegramContext();
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [saasUser, setSaasUser] = useState<SaaSUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);

  // Resolve or create SaaS user from Telegram identity
  const resolveUser = useCallback(async () => {
    if (!tgUser) { setUserLoading(false); return; }
    try {
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgUser.id,
          name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'User',
          username: tgUser.username,
        }),
      }).then((r) => r.json()).catch(() => null);
      if (res?.ok && res.user) setSaasUser(res.user);
    } catch { /* silent */ }
    finally { setUserLoading(false); }
  }, [tgUser]);

  useEffect(() => {
    if (isReady) resolveUser();
  }, [isReady, resolveUser]);

  if (!isReady || userLoading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-xs text-muted-foreground">Loading BidPilot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-background flex flex-col overflow-hidden">
      {isTelegramEnv === false && <BrowserBanner />}

      <main className="flex-1 overflow-hidden" style={{ paddingTop: 'var(--tg-safe-top, 0px)' }}>
        {activeTab === 'home' && (
          <div className="h-full overflow-y-auto fade-in">
<<<<<<< HEAD
            <DashboardScreen user={saasUser} onNavigate={setActiveTab} />
=======
            <DashboardScreen onNavigate={setActiveTab} />
>>>>>>> dd99fc0 (resolve merge conflicts)
          </div>
        )}
        {activeTab === 'freelance' && (
          <div className="h-full overflow-y-auto fade-in">
            <FreelanceScreen user={saasUser} />
          </div>
        )}
        {activeTab === 'campaigns' && (
          <div className="h-full overflow-y-auto fade-in">
            <CampaignsScreen user={saasUser} />
          </div>
        )}
        {activeTab === 'logs' && (
          <div className="h-full fade-in">
<<<<<<< HEAD
            <LogsScreen userId={saasUser?.id} />
=======
            <LogsScreen />
>>>>>>> dd99fc0 (resolve merge conflicts)
          </div>
        )}
        {activeTab === 'account' && (
          <div className="h-full overflow-y-auto fade-in">
            <AccountScreen
              user={saasUser}
              onUserUpdate={setSaasUser}
              onAdminPanel={() => setActiveTab('admin')}
            />
          </div>
        )}
        {activeTab === 'admin' && (
          <div className="h-full overflow-y-auto fade-in">
            <AdminScreen user={saasUser} />
          </div>
        )}
      </main>

      <BottomNavigation
<<<<<<< HEAD
        active={activeTab}
        onChange={setActiveTab}
        isAdmin={saasUser?.role === 'owner' || saasUser?.role === 'admin'}
      />
=======
  active={activeTab}
  onChange={setActiveTab}
/>
>>>>>>> dd99fc0 (resolve merge conflicts)
    </div>
  );
}

function BrowserBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-400 text-xs">
      <span className="font-semibold flex-1">
        Browser preview mode — open in Telegram for the full experience
      </span>

      <button onClick={() => setDismissed(true)} className="text-yellow-400/60 hover:text-yellow-400 font-bold">
        ×
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <TelegramProvider>
      <AppShell />
    </TelegramProvider>
  );
}