'use client';

import { useState, useEffect } from 'react';
import {
  Shield, CheckCircle2, XCircle, Loader2,
  RefreshCw, AlertTriangle, Monitor, ArrowRight,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';

type Step =
  | 'idle'        // initial state before first check
  | 'checking'    // verifying session via API
  | 'valid'       // session verified successfully
  | 'expired'     // session expired — needs re-login
  | 'missing'     // storageState.json not found
  | 'error';      // unexpected error

interface FreelancehuntConnectScreenProps {
  onConnected: () => void;
  onSkip: () => void;
}

export function FreelancehuntConnectScreen({ onConnected, onSkip }: FreelancehuntConnectScreenProps) {
  const [step, setStep]             = useState<Step>('idle');
  const [username, setUsername]     = useState<string | undefined>();
  const [errorMsg, setErrorMsg]     = useState<string | undefined>();
  const [sessionPath, setSessionPath] = useState<string | undefined>();

  // Auto-verify on mount — no manual "Open browser" step needed
  useEffect(() => {
    handleVerify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify() {
    haptic.medium();
    setStep('checking');
    setErrorMsg(undefined);

    try {
      const res = await fetch('/api/freelancehunt/status');
      const data = await res.json();

      if (!data.ok) {
        setErrorMsg(data.error ?? 'Cannot reach worker');
        setStep('error');
        haptic.error();
        return;
      }

      const fh = data.data ?? data;
      setSessionPath(fh.sessionPath ?? undefined);

      if (!fh.connected) {
        const errMsg: string = typeof fh.error === 'string' ? fh.error.toLowerCase() : '';
        if (errMsg.includes('not found') || errMsg.includes('missing')) {
          setStep('missing');
        } else if (errMsg.includes('expired')) {
          setStep('expired');
        } else {
          setStep('missing');
        }
        haptic.error();
        return;
      }

      setUsername(fh.username);
      setStep('valid');
      haptic.success();
      setTimeout(() => onConnected(), 1200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection error');
      setStep('error');
      haptic.error();
    }
  }

  const isChecking = step === 'checking' || step === 'idle';

  return (
    <div className="flex flex-col min-h-dvh px-5 pt-6 pb-28 fade-in">

      {/* Header */}
      <h1 className="text-xl font-bold mb-1">Freelancehunt Session</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Auto-bid runs through the local Playwright browser using your saved session.
        No manual login required.
      </p>

      {/* Local-only mode badge */}
      <div className="glass-card p-3 rounded-2xl mb-4 border border-primary/20 bg-primary/5 flex items-center gap-2.5">
        <Monitor size={15} className="text-primary flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-primary">Local-only mode</p>
          <p className="text-[11px] text-muted-foreground">Recommended for stable Freelancehunt automation</p>
        </div>
      </div>

      {/* Session status card */}
      <div className={cn(
        'glass-card p-4 rounded-2xl border mb-4 transition-all',
        step === 'valid'                  && 'border-green-500/30 bg-green-500/5',
        step === 'missing'                && 'border-yellow-500/20 bg-yellow-500/5',
        step === 'expired'                && 'border-red-500/20 bg-red-500/5',
        step === 'error'                  && 'border-destructive/30 bg-destructive/10',
        (step === 'idle' || isChecking)   && 'border-border',
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
            step === 'valid'   && 'bg-green-500/20',
            step === 'missing' && 'bg-yellow-500/15',
            step === 'expired' && 'bg-red-500/15',
            step === 'error'   && 'bg-destructive/15',
            isChecking         && 'bg-secondary',
          )}>
            {isChecking        && <Loader2 size={18} className="text-primary animate-spin" />}
            {step === 'valid'  && <CheckCircle2 size={18} className="text-green-400" />}
            {step === 'missing'&& <AlertTriangle size={18} className="text-yellow-400" />}
            {step === 'expired'&& <XCircle size={18} className="text-red-400" />}
            {step === 'error'  && <XCircle size={18} className="text-destructive" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-semibold',
              step === 'valid'   && 'text-green-400',
              step === 'missing' && 'text-yellow-400',
              step === 'expired' && 'text-red-400',
              step === 'error'   && 'text-destructive',
            )}>
              {isChecking        && 'Verifying session...'}
              {step === 'valid'  && `Logged in${username ? ` — ${username}` : ''}`}
              {step === 'missing'&& 'storageState.json not found'}
              {step === 'expired'&& 'Session expired'}
              {step === 'error'  && 'Error'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {isChecking        && 'Opening freelancehunt.com/my/ to verify...'}
              {step === 'valid'  && (sessionPath ? sessionPath.split('/').pop() : 'storageState.json')}
              {step === 'missing'&& 'Run: npm run login:freelancehunt locally, then redeploy'}
              {step === 'expired'&& 'Re-run: npm run login:freelancehunt to refresh the session'}
              {step === 'error'  && (errorMsg ?? 'Unexpected error')}
            </p>
          </div>
        </div>
      </div>

      {/* Setup instructions when session is missing or expired */}
      {(step === 'missing' || step === 'expired') && (
        <div className="glass-card p-4 rounded-2xl mb-4 flex flex-col gap-2.5">
          <p className="text-xs font-semibold">How to create a session</p>
          {[
            { n: 1, text: <>Run <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded">npm run login:freelancehunt</code> locally</> },
            { n: 2, text: 'Log in to Freelancehunt in the browser that opens' },
            { n: 3, text: <><kbd className="font-mono text-foreground bg-secondary px-1 py-0.5 rounded text-[10px]">ENTER</kbd> — <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded">storageState.json</code> is saved automatically</> },
            { n: 4, text: 'Commit the file and redeploy to Railway' },
          ].map(({ n, text }) => (
            <div key={n} className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Security note */}
      <div className="glass-card p-3 rounded-2xl flex gap-2.5 mb-6">
        <Shield size={13} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Your password is never stored. Only browser session cookies in{' '}
          <code className="font-mono text-foreground">storageState.json</code> are used.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 mt-auto">
        {step === 'valid' && (
          <button
            onClick={onConnected}
            className="w-full py-4 rounded-2xl font-semibold text-sm bg-green-500 text-white transition-all active:scale-95 flex items-center justify-center gap-2 brand-glow"
          >
            <CheckCircle2 size={16} />
            Continue to Dashboard
            <ArrowRight size={16} />
          </button>
        )}

        {(step === 'missing' || step === 'expired' || step === 'error') && (
          <button
            onClick={handleVerify}
            className="w-full py-4 rounded-2xl font-semibold text-sm bg-primary text-primary-foreground transition-all active:scale-95 flex items-center justify-center gap-2 brand-glow"
          >
            <RefreshCw size={15} />
            Re-check session
          </button>
        )}

        {isChecking && (
          <div className="w-full py-4 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Verifying session...
          </div>
        )}

        <button
          onClick={() => { haptic.light(); onSkip(); }}
          disabled={isChecking}
          className="w-full py-3 text-sm text-muted-foreground font-medium disabled:opacity-40"
        >
          Skip, connect later
        </button>
      </div>
    </div>
  );
}
