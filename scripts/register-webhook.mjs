/**
 * scripts/register-webhook.mjs
 *
 * Registers the Telegram Bot webhook with the deployed Vercel app URL.
 * Run after every new deployment:
 *
 *   node scripts/register-webhook.mjs
 *
 * Reads env vars from process.env (set via .env.local or shell).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.local if running locally ───────────────────────────────────────
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('Loaded .env.local');
} catch {
  // No .env.local — rely on process.env (CI / Vercel)
}

// ── Validate required vars ────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

if (!BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}
if (!APP_URL) {
  console.error('ERROR: NEXT_PUBLIC_APP_URL is not set');
  process.exit(1);
}

const WEBHOOK_URL = `${APP_URL}/api/webhook`;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Register webhook ──────────────────────────────────────────────────────────
console.log(`\nRegistering webhook: ${WEBHOOK_URL}\n`);

const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: WEBHOOK_URL,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query', 'inline_query'],
    drop_pending_updates: true,
  }),
});

const data = await res.json();
console.log('setWebhook result:', JSON.stringify(data, null, 2));

// ── Verify ────────────────────────────────────────────────────────────────────
const infoRes = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
const info = await infoRes.json();
console.log('\ngetWebhookInfo:', JSON.stringify(info.result, null, 2));

// ── Bot info ──────────────────────────────────────────────────────────────────
const meRes = await fetch(`${TELEGRAM_API}/getMe`);
const me = await meRes.json();
console.log('\nBot:', me.result?.first_name, `(@${me.result?.username})`);

if (data.ok) {
  console.log('\nWebhook registered successfully.');
} else {
  console.error('\nFailed to register webhook:', data.description);
  process.exit(1);
}
