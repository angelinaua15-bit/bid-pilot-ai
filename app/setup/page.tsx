'use client';

import { useState } from 'react';

type Status = 'idle' | 'loading' | 'ok' | 'error';

interface Check {
  label: string;
  status: Status;
  detail?: string;
}

const SECRET = 'IvanivAngelina15032008';
const APP_URL = 'https://v0-bidpilot-ai-saas.vercel.app';
const BOT_TOKEN = '8676026319:AAFmZ0kdiAPbMXLpsJJY6fN_uxZ78QxCN-0';

export default function SetupPage() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const update = (label: string, status: Status, detail?: string) => {
    setChecks(prev => {
      const idx = prev.findIndex(c => c.label === label);
      const next = { label, status, detail };
      if (idx === -1) return [...prev, next];
      return prev.map((c, i) => (i === idx ? next : c));
    });
  };

  const run = async () => {
    setRunning(true);
    setDone(false);
    setChecks([]);

    // ── 1. Verify bot token ───────────────────────────────────────────────────
    update('Bot token (getMe)', 'loading');
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
      ).then(r => r.json());
      if (r.ok) {
        const b = r.result;
        update('Bot token (getMe)', 'ok', `@${b.username} — ID ${b.id}`);
      } else {
        update('Bot token (getMe)', 'error', r.description ?? 'unknown error');
      }
    } catch (e) {
      update('Bot token (getMe)', 'error', String(e));
    }

    // ── 2. Register webhook ───────────────────────────────────────────────────
    update('Register webhook (setWebhook)', 'loading');
    try {
      const r = await fetch(
        `/api/webhook/setup?secret=${SECRET}`
      ).then(r => r.json());
      if (r.ok) {
        const url = r.webhookInfo?.result?.url ?? r.registered ?? '';
        update('Register webhook (setWebhook)', 'ok', url);
      } else {
        update('Register webhook (setWebhook)', 'error', r.error ?? r.setWebhookResult?.description ?? 'failed');
      }
    } catch (e) {
      update('Register webhook (setWebhook)', 'error', String(e));
    }

    // ── 3. Verify webhook info ────────────────────────────────────────────────
    update('Verify webhook (getWebhookInfo)', 'loading');
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
      ).then(r => r.json());
      if (r.ok) {
        const wi = r.result;
        const registeredUrl = wi.url ?? '';
        const expectedUrl = `${APP_URL}/api/webhook`;
        const match = registeredUrl === expectedUrl;
        update(
          'Verify webhook (getWebhookInfo)',
          match ? 'ok' : 'error',
          match
            ? `Registered: ${registeredUrl}`
            : `Got: "${registeredUrl}" | Expected: "${expectedUrl}"`
        );
      } else {
        update('Verify webhook (getWebhookInfo)', 'error', r.description ?? 'failed');
      }
    } catch (e) {
      update('Verify webhook (getWebhookInfo)', 'error', String(e));
    }

    // ── 4. Ping the webhook endpoint ─────────────────────────────────────────
    update('Webhook endpoint reachable (/api/webhook)', 'loading');
    try {
      const res = await fetch('/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: JSON.stringify({ update_id: 0 }),
      });
      if (res.ok) {
        update('Webhook endpoint reachable (/api/webhook)', 'ok', `HTTP ${res.status}`);
      } else {
        update('Webhook endpoint reachable (/api/webhook)', 'error', `HTTP ${res.status}`);
      }
    } catch (e) {
      update('Webhook endpoint reachable (/api/webhook)', 'error', String(e));
    }

    // ── 5. Check env vars (server-side) ──────────────────────────────────────
    update('Environment variables (/api/health)', 'loading');
    try {
      const r = await fetch('/api/health').then(r => r.json());
      if (r.ok) {
        const missing = (r.missing ?? []) as string[];
        if (missing.length === 0) {
          update('Environment variables (/api/health)', 'ok', Object.entries(r.vars as Record<string, boolean>).map(([k, v]) => `${k}: ${v ? 'set' : 'MISSING'}`).join(' | '));
        } else {
          update('Environment variables (/api/health)', 'error', `Missing: ${missing.join(', ')}`);
        }
      } else {
        update('Environment variables (/api/health)', 'error', 'health endpoint failed');
      }
    } catch (e) {
      update('Environment variables (/api/health)', 'error', String(e));
    }

    setRunning(false);
    setDone(true);
  };

  const statusIcon = (s: Status) => {
    if (s === 'loading') return <span className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />;
    if (s === 'ok') return <span className="text-green-400 font-bold">+</span>;
    if (s === 'error') return <span className="text-red-400 font-bold">x</span>;
    return <span className="text-muted-foreground">·</span>;
  };

  const allOk = checks.length > 0 && checks.every(c => c.status === 'ok');

  return (
    <div className="min-h-dvh bg-background text-foreground font-mono p-6 max-w-xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-foreground">BidPilot AI — Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One-click Telegram webhook registration and health check.
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          App: {APP_URL}
        </p>
      </div>

      <button
        onClick={run}
        disabled={running}
        className="w-full py-3 px-6 rounded-xl bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mb-6"
      >
        {running ? 'Running checks...' : 'Run Setup & Verify'}
      </button>

      {checks.length > 0 && (
        <div className="space-y-3">
          {checks.map(c => (
            <div key={c.label} className="bg-secondary rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2">
                <span className="shrink-0">{statusIcon(c.status)}</span>
                <span className="text-sm font-semibold text-foreground">{c.label}</span>
              </div>
              {c.detail && (
                <p className="text-xs text-muted-foreground pl-6 break-all">{c.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {done && (
        <div className={`mt-6 rounded-xl p-4 text-sm font-semibold ${allOk ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {allOk
            ? 'All checks passed. Your bot is ready! Open Telegram and send /start to your bot.'
            : 'Some checks failed. Review the errors above and redeploy if needed.'}
        </div>
      )}

      {done && allOk && (
        <a
          href={`https://t.me/bidpilotbot`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center justify-center py-3 px-6 rounded-xl bg-[#229ED9] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Open Bot in Telegram
        </a>
      )}

      <div className="mt-10 border-t border-border pt-6 space-y-2 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Manual webhook registration:</p>
        <pre className="bg-secondary rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">
{`curl "${APP_URL}/api/webhook/setup?secret=${SECRET}"`}
        </pre>
        <p className="font-semibold text-foreground mt-4">Check webhook status directly:</p>
        <a
          href={`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          api.telegram.org/bot.../getWebhookInfo
        </a>
      </div>
    </div>
  );
}
