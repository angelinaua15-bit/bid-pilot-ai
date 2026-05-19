/**
 * scripts/login-freelancehunt.ts
 *
 * Interactive login script that saves a Playwright storageState.json
 * for use by the bid-submission automation.
 *
 * Usage:
 *   npm run login:freelancehunt
 *   pnpm login:freelancehunt
 *
 * What it does:
 *   1. Opens a visible Chromium browser at freelancehunt.com/login
 *   2. Waits for you to log in manually (60 second timeout)
 *   3. Detects login success by checking for the dashboard/profile element
 *   4. Saves storageState.json (cookies + localStorage) to project root
 *   5. Prints the path so you can copy it to your Railway deployment
 *
 * The saved file is used by playwright-browser.service.ts for headless
 * bid submission. Keep it secure — it contains your session cookies.
 */

import path from 'path';
import { chromium } from 'playwright';

const OUTPUT_PATH = path.resolve(process.cwd(), 'storageState.json');
const LOGIN_URL = 'https://freelancehunt.com/login';
const TIMEOUT_MS = 120_000; // 2 minutes to log in

async function main() {
  console.log('\n[login] Launching browser for manual Freelancehunt login...');
  console.log('[login] Please log in within 2 minutes.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'uk-UA',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  console.log(`[login] Opened ${LOGIN_URL}`);

  // Wait for any of these post-login indicators
  const successSelectors = [
    'a[href*="/my/"]',          // "My profile" link
    '.user-menu',               // User avatar/menu
    '[data-user-id]',           // Any element with user data
    'a[href*="/freelancer/"]',  // Freelancer profile link
    '.header-user',             // Header user block
    '.nav-user',                // Navigation user block
  ];

  console.log('[login] Waiting for you to log in...');

  try {
    await page.waitForSelector(successSelectors.join(', '), {
      timeout: TIMEOUT_MS,
      state: 'visible',
    });
    console.log('[login] Login detected!');
  } catch {
    console.error('[login] Timed out waiting for login. Please try again.');
    await browser.close();
    process.exit(1);
  }

  // Save the full storage state
  await context.storageState({ path: OUTPUT_PATH });
  console.log(`\n[login] Session saved to: ${OUTPUT_PATH}`);
  console.log('[login] Copy this file to your Railway deployment as storageState.json');
  console.log('[login] Or set FREELANCEHUNT_SESSION_PATH env var to point to it.\n');

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[login] Fatal error:', err);
  process.exit(1);
});
