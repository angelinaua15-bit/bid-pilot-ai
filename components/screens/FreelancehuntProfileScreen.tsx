'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  User, CheckCircle2, XCircle, Loader2,
  RefreshCw, LogOut, Monitor, Globe,
  AlertTriangle, Clock, Shield, ArrowRight,
  Wifi, WifiOff, Link2, Link2Off,
} from 'lucide-react';
import { haptic, openExternalLink } from '@/lib/telegram';
import { useTelegram } from '@/hooks/useTelegram';
import { userMessageForCode } from '@/lib/playwright-errors';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

type ConnectStep =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'logged_in'
  | 'saving'
  | 'saved'
  | 'error';

interface SessionStatus {
  connected: boolean;
  username?: string;
  cookieCount?: number;
  sessionPath?: string;
  sessionCreatedAt?: string;
  error?: string;
  autoLoop?: {
    enabled: boolean;
    intervalMs: number;
    lastCheckedAt: string | null;
    lastError: string | null;
  };
}


/** Turn any API error payload into a user-facing message — never a raw stack. */
function friendlyError(data: { code?: string; message?: string; error?: string } | null | undefined): string {
  if (!data) return 'Сталася помилка. Спробуйте пізніше.';
  if (data.message) return data.message;
  if (data.code) return userMessageForCode(data.code);
  const raw = data.error ?? '';
  if (/Executable doesn't exist|playwright install|ms-playwright|browserType\.launch/i.test(raw)) {
    return 'Worker не налаштований. Chromium не встановлено на Railway.';
  }
  return raw || 'Сталася помилка. Спробуйте пізніше.';
}

export function FreelancehuntProfileScreen() {
  const { user } = useTelegram();
  const userId = user?.id ? String(user.id) : '';
  const [status, setStatus]         = useState<SessionStatus | null>(null);
  const [loading, setLoading]       = useState(true);
  const [step, setStep]             = useState<ConnectStep>('idle');
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [username, setUsername]     = useState<string | undefined>();
  const [errorMsg, setErrorMsg]     = useState<string | undefined>();
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [workerAvailable, setWorkerAvailable] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function handleBrowserConnect() {
    haptic.medium();
    const url = `${window.location.origin}/freelancehunt/connect${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`;
    openExternalLink(url);
  }

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/freelancehunt/status${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);
      const data = await res.json();
      if (data.ok) setStatus(data.data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadStatus();
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => setWorkerAvailable(d.workerMode === true))
      .catch(() => setWorkerAvailable(false));
  }, [loadStatus]);

  // Poll while waiting for login
  useEffect(() => {
    if (step !== 'waiting' || !sessionId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/connect/freelancehunt?session=${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (!data.ok) {
          stopPolling();
          setErrorMsg(friendlyError(data));
          setStep('error');
          haptic.error();
          return;
        }

        if (data.status === 'logged_in') {
          stopPolling();
          setUsername(data.username);
          setStep('logged_in');
          haptic.success();
        } else if (data.status === 'error') {
          stopPolling();
          setErrorMsg(friendlyError(data));
          setStep('error');
          haptic.error();
        }
      } catch {
        // transient network error — keep polling
      }
    }, 2500);

    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionId]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleConnect() {
    haptic.medium();
    setStep('starting');
    setErrorMsg(undefined);

    try {
      const res = await fetch('/api/connect/freelancehunt', { method: 'POST' });
      const data = await res.json();

      if (!data.ok || !data.sessionId) {
        setErrorMsg(friendlyError(data));
        setStep('error');
        haptic.error();
        return;
      }

      setSessionId(data.sessionId);
      setStep('waiting');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection error');
      setStep('error');
      haptic.error();
    }
  }

  async function handleSave() {
    if (!sessionId) return;
    haptic.medium();
    setStep('saving');

    try {
      const res = await fetch('/api/connect/freelancehunt?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();

      if (!data.ok) {
        setErrorMsg(friendlyError(data));
        setStep('error');
        haptic.error();
        return;
      }

      setStep('saved');
      haptic.success();
      await loadStatus();
      setTimeout(() => setStep('idle'), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save error');
      setStep('error');
      haptic.error();
    }
  }

  async function handleLogout() {
    haptic.error();
    setLogoutLoading(true);
    try {
      await fetch('/api/connect/freelancehunt?action=logout', { method: 'POST' });
      await loadStatus();
      setStep('idle');
    } finally {
      setLogoutLoading(false);
    }
  }

  function handleRetry() {
    stopPolling();
    setStep('idle');
    setSessionId(null);
    setErrorMsg(undefined);
    setUsername(undefined);
  }

  const isConnected = status?.connected;
  const isWorking = step === 'starting' || step === 'waiting' || step === 'saving';

  return (
    <div className="flex flex-col pb-nav px-4 pt-4 fade-in gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-balance">Freelancehunt Profile</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Session &amp; auto-bid connection</p>
        </div>
        <button
          onClick={() => { haptic.light(); loadStatus(); }}
          disabled={loading}
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* No worker warning */}
      {workerAvailable === false && (
        <div className="glass-card p-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-yellow-400 mb-1">Worker not connected</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
              Set <code className="font-mono text-foreground">AUTOMATION_WORKER_URL</code> and deploy the worker to Railway.
            </p>
          </div>
        </div>
      )}

      {/* Session status card */}
      {loading ? (
        <div className="glass-card p-4 rounded-2xl flex items-center justify-center h-24">
          <Loader2 size={20} className="text-muted-foreground animate-spin" />
        </div>
      ) : (
        <div className={cn(
          'glass-card p-4 rounded-2xl border transition-all',
          isConnected ? 'border-green-500/30 bg-green-500/5' : 'border-border'
        )}>
          <div className="flex items-center gap-3 mb-3">
            <div className={cn(
              'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
              isConnected ? 'bg-green-500/20' : 'bg-secondary'
            )}>
              <User size={18} className={isConnected ? 'text-green-400' : 'text-muted-foreground'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">
                  {isConnected ? (status?.username ?? 'Connected') : 'Not connected'}
                </p>
                {isConnected ? (
                  <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle size={13} className="text-muted-foreground flex-shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {isConnected
                  ? `${status?.cookieCount ?? 0} cookies saved${status?.sessionPath ? ` · ${status.sessionPath.split('/').pop()}` : ''}`
                  : 'Log in once to enable auto-bidding'}
              </p>
            </div>
            <div className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-semibold',
              isConnected ? 'bg-green-500/15 text-green-400' : 'bg-secondary text-muted-foreground'
            )}>
              {isConnected ? 'Active' : 'Offline'}
            </div>
          </div>

          {/* Session details */}
          {isConnected && (
            <div className="flex flex-col gap-1.5 mb-3">
              {status?.sessionCreatedAt && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock size={11} className="flex-shrink-0" />
                  <span>Session created {formatDistanceToNow(new Date(status.sessionCreatedAt), { addSuffix: true, locale: uk })}</span>
                </div>
              )}
              {status?.autoLoop && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {status.autoLoop.enabled ? (
                    <Wifi size={11} className="text-green-400 flex-shrink-0" />
                  ) : (
                    <WifiOff size={11} className="flex-shrink-0" />
                  )}
                  <span>
                    Auto-loop {status.autoLoop.enabled ? 'running' : 'stopped'}
                    {status.autoLoop.lastCheckedAt && (
                      <> · last checked {formatDistanceToNow(new Date(status.autoLoop.lastCheckedAt), { addSuffix: true, locale: uk })}</>
                    )}
                  </span>
                </div>
              )}
              {status?.autoLoop?.lastError && (
                <div className="flex items-center gap-2 text-[11px] text-red-400">
                  <AlertTriangle size={11} className="flex-shrink-0" />
                  <span className="truncate">{status.autoLoop.lastError}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions for connected state */}
          {isConnected && step === 'idle' && (
            <div className="flex gap-2">
              <button
                onClick={handleConnect}
                disabled={workerAvailable === false}
                className="flex-1 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-40"
              >
                <RefreshCw size={13} />
                Reconnect
              </button>
              <button
                onClick={handleLogout}
                disabled={logoutLoading}
                className="flex-1 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-40"
              >
                {logoutLoading ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                Logout
              </button>
            </div>
          )}
        </div>
      )}

      {/* Connect flow steps — shown when connecting */}
      {(step !== 'idle' || !isConnected) && (
        <div className="flex flex-col gap-2">

          {/* Error banner */}
          {step === 'error' && (
            <div className="glass-card p-3 rounded-2xl border border-destructive/30 bg-destructive/10 flex items-start gap-3">
              <XCircle size={15} className="text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">Error</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{errorMsg}</p>
              </div>
            </div>
          )}

          {step === 'saved' && (
            <div className="glass-card p-3 rounded-2xl border border-green-500/30 bg-green-500/10 flex items-center gap-3">
              <CheckCircle2 size={15} className="text-green-400 flex-shrink-0" />
              <p className="text-xs font-semibold text-green-400">Session saved successfully!</p>
            </div>
          )}

          {/* Step indicators */}
          <div className={cn('glass-card p-3 rounded-2xl border transition-all', step === 'starting' ? 'border-primary/30' : 'border-border opacity-60')}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 bg-secondary">
                {step === 'starting'
                  ? <Loader2 size={14} className="text-primary animate-spin" />
                  : <Monitor size={14} className="text-muted-foreground" />
                }
              </div>
              <div>
                <p className="text-xs font-semibold">Open browser</p>
                <p className="text-[11px] text-muted-foreground">Worker launches Chromium</p>
              </div>
            </div>
          </div>

          <div className={cn(
            'glass-card p-3 rounded-2xl border transition-all',
            step === 'waiting' ? 'border-primary/30' :
            (step === 'logged_in' || step === 'saving' || step === 'saved') ? 'border-green-500/20 opacity-80' :
            'border-border opacity-40'
          )}>
            <div className="flex items-center gap-2.5">
              <div className={cn('w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0', step === 'waiting' ? 'bg-primary/20' : (step === 'logged_in' || step === 'saving' || step === 'saved') ? 'bg-green-500/20' : 'bg-secondary')}>
                {step === 'waiting' ? <RefreshCw size={14} className="text-primary animate-spin" /> :
                 (step === 'logged_in' || step === 'saving' || step === 'saved') ? <CheckCircle2 size={14} className="text-green-400" /> :
                 <Globe size={14} className="text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">Log in to Freelancehunt</p>
                <p className="text-[11px] text-muted-foreground">
                  {step === 'waiting' ? 'Waiting for login in browser...' :
                   (step === 'logged_in' || step === 'saving' || step === 'saved') ? `Login detected${username ? ` — ${username}` : ''}` :
                   'Enter your credentials in the browser'}
                </p>
              </div>
            </div>
          </div>

          <div className={cn(
            'glass-card p-3 rounded-2xl border transition-all',
            step === 'logged_in' ? 'border-primary/30' :
            step === 'saved' ? 'border-green-500/20 opacity-80' :
            'border-border opacity-40'
          )}>
            <div className="flex items-center gap-2.5">
              <div className={cn('w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0', step === 'saving' ? 'bg-primary/20' : step === 'saved' ? 'bg-green-500/20' : 'bg-secondary')}>
                {step === 'saving' ? <Loader2 size={14} className="text-primary animate-spin" /> :
                 step === 'saved' ? <CheckCircle2 size={14} className="text-green-400" /> :
                 <Shield size={14} className="text-muted-foreground" />}
              </div>
              <div>
                <p className="text-xs font-semibold">Save session</p>
                <p className="text-[11px] text-muted-foreground">Cookies stored on Railway volume</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security note */}
      {!isConnected && step === 'idle' && (
        <div className="glass-card p-3 rounded-2xl flex gap-2.5">
          <Shield size={14} className="text-primary flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your password is never stored. Only the browser session cookies are saved to the Railway persistent volume.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 mt-auto">
        {!isConnected && (step === 'idle' || step === 'error') && (
          <button
            onClick={handleBrowserConnect}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm bg-primary text-primary-foreground brand-glow transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <Globe size={15} />
            Підключити Freelancehunt через браузер
          </button>
        )}
        {(step === 'idle' || step === 'error') && !isConnected && (
          <button
            onClick={step === 'error' ? handleRetry : handleConnect}
            disabled={workerAvailable === false}
            className={cn(
              'w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex items-center justify-center gap-2',
              workerAvailable !== false
                ? 'bg-primary text-primary-foreground brand-glow'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {step === 'error' ? (
              <><RefreshCw size={15} />Try again</>
            ) : (
              <><Link2 size={15} />Connect Freelancehunt</>
            )}
          </button>
        )}

        {step === 'starting' && (
          <div className="w-full py-3.5 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Opening browser...
          </div>
        )}

        {step === 'waiting' && (
          <div className="w-full py-3.5 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw size={14} className="animate-spin" />
            Waiting for login...
          </div>
        )}

        {step === 'logged_in' && (
          <button
            onClick={handleSave}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm bg-green-500 text-white transition-all active:scale-95 flex items-center justify-center gap-2 brand-glow"
          >
            <CheckCircle2 size={15} />
            Save session &amp; continue
            <ArrowRight size={15} />
          </button>
        )}

        {step === 'saving' && (
          <div className="w-full py-3.5 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Saving session...
          </div>
        )}

        {step === 'saved' && (
          <div className="w-full py-3.5 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center gap-2 text-sm text-green-400 font-semibold">
            <CheckCircle2 size={15} />
            Connected!
          </div>
        )}

        {/* Disconnect link for connected state when not in connect flow */}
        {isConnected && step === 'idle' && (
          <div className="glass-card p-3 rounded-2xl flex items-start gap-2.5">
            <Link2Off size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              If the session expires, click <strong className="text-foreground">Reconnect</strong> and log in again. The auto-loop will resume automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}