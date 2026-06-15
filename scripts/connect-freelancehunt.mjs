/**
 * scripts/connect-freelancehunt.mjs
 *
 * Zero-extension fallback. Opens a REAL visible Chromium window, the user logs
 * into Freelancehunt manually, then the captured session is uploaded to the app
 * under their userId (resolved from the one-time connect code).
 *
 * Run:
 *   APP_URL=https://your-app.vercel.app CODE=<connect-code> node scripts/connect-freelancehunt.mjs
 *
 * Requires: npm i -D playwright   (and `npx playwright install chromium` once)
 */

import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL;
const CODE = process.env.CODE;

if (!APP_URL || !CODE) {
  console.error('Set APP_URL and CODE env vars. Example:');
  console.error('  APP_URL=https://your-app.vercel.app CODE=abc123 node scripts/connect-freelancehunt.mjs');
  process.exit(1);
}

const LOGIN_URL = 'https://freelancehunt.com/login';
const PROFILE_PROBE = 'https://freelancehunt.com/my/profile';

console.log('Opening browser — log into Freelancehunt in the window that appears…');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'uk-UA' });
const page = await context.newPage();
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

// Wait until the user is logged in: poll for a logged-in signal (no login form / profile reachable).
console.log('Waiting for you to log in (up to 5 minutes)…');
const deadline = Date.now() + 5 * 60_000;
let loggedIn = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const onLogin = page.url().includes('/login');
  if (onLogin) continue;
  // Probe an authenticated page
  const resp = await page.goto(PROFILE_PROBE, { waitUntil: 'domcontentloaded' }).catch(() => null);
  const stillLogin = page.url().includes('/login');
  if (resp && resp.ok() && !stillLogin) {
    loggedIn = true;
    break;
  }
}

if (!loggedIn) {
  console.error('Login not detected in time. Aborting.');
  await browser.close();
  process.exit(1);
}

const storageState = await context.storageState();
console.log(`Captured session: ${storageState.cookies.length} cookies. Uploading…`);

const res = await fetch(`${APP_URL}/api/freelancehunt/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: CODE, storageState }),
});
const data = await res.json().catch(() => ({}));

await browser.close();

if (res.ok && data.ok) {
  console.log(`Connected ✓ (user ${data.userId}, ${data.cookieCount} cookies). You can close this.`);
  process.exit(0);
} else {
  console.error(`Upload failed: ${data.error ?? res.status}`);
  process.exit(1);
}