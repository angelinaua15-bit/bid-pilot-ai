/**
 * scripts/register-webhook.js
 *
 * Registers the Telegram Bot webhook with the deployed Vercel app URL.
 * Reads TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_APP_URL, TELEGRAM_WEBHOOK_SECRET
 * from environment variables (injected by Vercel sandbox).
 */

const https = require('https');
const http = require('http');

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  if (!BOT_TOKEN) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is not set');
    process.exit(1);
  }
  if (!APP_URL) {
    console.error('ERROR: NEXT_PUBLIC_APP_URL is not set');
    process.exit(1);
  }

  const WEBHOOK_URL = `${APP_URL}/api/webhook`;
  const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

  console.log('Bot token (masked):', BOT_TOKEN.slice(0, 10) + '...');
  console.log('App URL:           ', APP_URL);
  console.log('Webhook URL:       ', WEBHOOK_URL);
  console.log('Secret (masked):   ', SECRET ? SECRET.slice(0, 4) + '...' : '(none)');
  console.log('');

  // ── 1. Get bot info ─────────────────────────────────────────────────────────
  const me = await request(`${API}/getMe`, { method: 'GET' });
  if (!me.ok) {
    console.error('getMe failed — invalid bot token?', me);
    process.exit(1);
  }
  console.log(`Bot: ${me.result.first_name} (@${me.result.username})`);
  console.log('');

  // ── 2. Register webhook ─────────────────────────────────────────────────────
  const payload = JSON.stringify({
    url: WEBHOOK_URL,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query', 'inline_query'],
    drop_pending_updates: true,
  });

  const setResult = await request(`${API}/setWebhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  console.log('setWebhook result:', JSON.stringify(setResult, null, 2));

  // ── 3. Verify ───────────────────────────────────────────────────────────────
  const info = await request(`${API}/getWebhookInfo`, { method: 'GET' });
  console.log('');
  console.log('Webhook info:');
  console.log('  url:               ', info.result?.url || '(none)');
  console.log('  pending_update_count:', info.result?.pending_update_count);
  console.log('  last_error_message:', info.result?.last_error_message || '(none)');

  if (setResult.ok) {
    console.log('');
    console.log('Webhook registered successfully.');
  } else {
    console.error('');
    console.error('Failed to register webhook:', setResult.description);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
