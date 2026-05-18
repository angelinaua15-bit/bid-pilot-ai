'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Shield, CheckCircle2, XCircle, Loader2,
  Monitor, RefreshCw, Globe, AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { cn } from '@/lib/utils';

type Step =
  | 'idle'          // not started yet
  | 'starting'      // POST /api/connect/freelancehunt in flight
  | 'waiting'       // browser opened, polling for login
  | 'logged_in'     // user is logged in, ready to save
  | 'saving'        // POST ?action=save in flight
  | 'saved'         // success
  | 'error';        // something went wrong

interface FreelancehuntConnectScreenProps {
  onConnected: () => void;
  onSkip: () => void;
}

const STEP_LABELS: Record<Step, string> = {
  idle:       'Підключення Freelancehunt',
  starting:   'Відкриваємо браузер...',
  waiting:    'Очікуємо вхід...',
  logged_in:  'Вхід виявлено!',
  saving:     'Зберігаємо сесію...',
  saved:      'Акаунт підключено!',
  error:      'Помилка підключення',
};

export function FreelancehuntConnectScreen({ onConnected, onSkip }: FreelancehuntConnectScreenProps) {
  const [step, setStep]             = useState<Step>('idle');
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [username, setUsername]     = useState<string | undefined>();
  const [cookieCount, setCookieCount] = useState<number | undefined>();
  const [errorMsg, setErrorMsg]     = useState<string | undefined>();
  const [workerAvailable, setWorkerAvailable] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if worker is reachable on mount
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => setWorkerAvailable(d.workerMode === true))
      .catch(() => setWorkerAvailable(false));
  }, []);

  // Poll /api/connect/freelancehunt?session=<id> while in 'waiting' state
  useEffect(() => {
    if (step !== 'waiting' || !sessionId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/connect/freelancehunt?session=${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (!data.ok) {
          stopPolling();
          setErrorMsg(data.error ?? 'Worker повернув помилку');
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
          setErrorMsg(data.error ?? 'Невідома помилка');
          setStep('error');
          haptic.error();
        }
        // 'pending' → keep polling
      } catch {
        // transient network error — keep polling
      }
    }, 2500);

    return stopPolling;
  }, [step, sessionId]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleStart() {
    haptic.medium();
    setStep('starting');
    setErrorMsg(undefined);

    try {
      const res = await fetch('/api/connect/freelancehunt', { method: 'POST' });
      const data = await res.json();

      if (!data.ok || !data.sessionId) {
        setErrorMsg(data.error ?? 'Не вдалося запустити браузер');
        setStep('error');
        haptic.error();
        return;
      }

      setSessionId(data.sessionId);
      setStep('waiting');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка підключення');
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
        setErrorMsg(data.error ?? 'Не вдалося зберегти сесію');
        setStep('error');
        haptic.error();
        return;
      }

      setUsername(data.username);
      setCookieCount(data.cookieCount);
      setStep('saved');
      haptic.success();
      setTimeout(() => onConnected(), 1500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка збереження');
      setStep('error');
      haptic.error();
    }
  }

  function handleRetry() {
    stopPolling();
    setStep('idle');
    setSessionId(null);
    setErrorMsg(undefined);
    setUsername(undefined);
  }

  const isWorking = step === 'starting' || step === 'waiting' || step === 'saving';

  return (
    <div className="flex flex-col min-h-dvh px-5 pt-6 pb-28 fade-in">

      {/* Header */}
      <h1 className="text-xl font-bold mb-1">Підключення Freelancehunt</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Увійдіть у Freelancehunt у браузері на вашому Mac&nbsp;— жодних паролів у застосунку.
      </p>

      {/* Worker not configured */}
      {workerAvailable === false && (
        <div className="glass-card p-4 rounded-2xl mb-5 border border-yellow-500/20 bg-yellow-500/5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400 mb-1">Worker не підключено</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              Для підключення Freelancehunt потрібен локальний worker на вашому Mac.
            </p>
            <code className="text-[11px] font-mono text-foreground bg-secondary px-2 py-1 rounded block">
              npm run worker
            </code>
            <p className="text-[11px] text-muted-foreground mt-2">
              Потім задайте <code className="font-mono">AUTOMATION_WORKER_URL</code> у Vercel.
            </p>
          </div>
        </div>
      )}

      {/* Status card */}
      {step === 'error' && (
        <div className="glass-card p-4 rounded-2xl mb-5 border border-destructive/30 bg-destructive/10 flex items-start gap-3">
          <XCircle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Помилка</p>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">{errorMsg}</p>
          </div>
        </div>
      )}

      {step === 'saved' && (
        <div className="glass-card p-4 rounded-2xl mb-5 border border-green-500/30 bg-green-500/10 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Підключено успішно!</p>
            {username && <p className="text-xs text-muted-foreground">@{username}{cookieCount ? ` · ${cookieCount} cookies` : ''}</p>}
          </div>
        </div>
      )}

      {/* Flow steps */}
      <div className="flex flex-col gap-3 mb-6">

        {/* Step 1 */}
        <div className={cn(
          'glass-card p-4 rounded-2xl border transition-all',
          step === 'idle' || step === 'starting' ? 'border-primary/30' : 'border-border opacity-60'
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
              step === 'starting' ? 'bg-primary/20' : 'bg-secondary'
            )}>
              {step === 'starting'
                ? <Loader2 size={16} className="text-primary animate-spin" />
                : <Monitor size={16} className="text-muted-foreground" />
              }
            </div>
            <div>
              <p className="text-sm font-semibold">Відкрити браузер</p>
              <p className="text-xs text-muted-foreground">Worker запустить Chromium на вашому Mac</p>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className={cn(
          'glass-card p-4 rounded-2xl border transition-all',
          step === 'waiting' ? 'border-primary/30' :
          step === 'logged_in' || step === 'saving' || step === 'saved' ? 'border-green-500/20 opacity-80' :
          'border-border opacity-40'
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
              step === 'waiting' ? 'bg-primary/20' :
              (step === 'logged_in' || step === 'saving' || step === 'saved') ? 'bg-green-500/20' :
              'bg-secondary'
            )}>
              {step === 'waiting' ? (
                <RefreshCw size={16} className="text-primary animate-spin" />
              ) : (step === 'logged_in' || step === 'saving' || step === 'saved') ? (
                <CheckCircle2 size={16} className="text-green-400" />
              ) : (
                <Globe size={16} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Увійдіть на Freelancehunt</p>
              <p className="text-xs text-muted-foreground">
                {step === 'waiting'
                  ? 'Очікуємо вхід у браузері...'
                  : (step === 'logged_in' || step === 'saving' || step === 'saved')
                    ? `Вхід виявлено${username ? ` — ${username}` : ''}!`
                    : 'Введіть логін і пароль у браузері'}
              </p>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className={cn(
          'glass-card p-4 rounded-2xl border transition-all',
          step === 'logged_in' ? 'border-primary/30' :
          step === 'saved' ? 'border-green-500/20 opacity-80' :
          'border-border opacity-40'
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
              step === 'saving' ? 'bg-primary/20' :
              step === 'saved' ? 'bg-green-500/20' :
              'bg-secondary'
            )}>
              {step === 'saving' ? (
                <Loader2 size={16} className="text-primary animate-spin" />
              ) : step === 'saved' ? (
                <CheckCircle2 size={16} className="text-green-400" />
              ) : (
                <Shield size={16} className="text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">Зберегти сесію</p>
              <p className="text-xs text-muted-foreground">Cookies зберігаються на вашому Mac</p>
            </div>
          </div>
        </div>
      </div>

      {/* Security notice */}
      <div className="glass-card p-4 rounded-2xl flex gap-3 mb-6">
        <Shield size={16} className="text-primary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Пароль не передається в застосунок. Файл сесії зберігається локально на вашому Mac і ніколи не завантажується на сервер.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 mt-auto">

        {/* Start button */}
        {(step === 'idle' || step === 'error') && (
          <button
            onClick={step === 'error' ? handleRetry : handleStart}
            disabled={workerAvailable === false}
            className={cn(
              'w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95 flex items-center justify-center gap-2',
              workerAvailable !== false
                ? 'bg-primary text-primary-foreground brand-glow'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            )}
          >
            {step === 'error' ? (
              <><RefreshCw size={16} />Спробувати ще раз</>
            ) : (
              <><Monitor size={16} />Відкрити браузер для входу</>
            )}
          </button>
        )}

        {/* Waiting — show status */}
        {step === 'waiting' && (
          <div className="w-full py-4 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw size={14} className="animate-spin" />
            Очікуємо вхід у браузері...
          </div>
        )}

        {/* Starting */}
        {step === 'starting' && (
          <div className="w-full py-4 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Відкриваємо браузер...
          </div>
        )}

        {/* Confirm save */}
        {step === 'logged_in' && (
          <button
            onClick={handleSave}
            className="w-full py-4 rounded-2xl font-semibold text-sm bg-green-500 text-white transition-all active:scale-95 flex items-center justify-center gap-2 brand-glow"
          >
            <CheckCircle2 size={16} />
            Зберегти сесію та продовжити
            <ArrowRight size={16} />
          </button>
        )}

        {/* Saving */}
        {step === 'saving' && (
          <div className="w-full py-4 rounded-2xl bg-secondary flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Зберігаємо сесію...
          </div>
        )}

        {/* Saved */}
        {step === 'saved' && (
          <div className="w-full py-4 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center gap-2 text-sm text-green-400 font-semibold">
            <CheckCircle2 size={16} />
            Підключено! Переходимо...
          </div>
        )}

        <button
          onClick={() => { haptic.light(); onSkip(); }}
          disabled={isWorking}
          className="w-full py-3 text-sm text-muted-foreground font-medium disabled:opacity-40"
        >
          Пропустити, підключити пізніше
        </button>
      </div>
    </div>
  );
}
