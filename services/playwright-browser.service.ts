/**
 * services/playwright-browser.service.ts
 *
 * Bid submission via Playwright browser automation.
 * POST /v2/projects/{id}/bids was removed (410 Gone) from the Freelancehunt API.
 *
 * Flow:
 *   1. Load storageState.json (authenticated session) — fail fast if missing
 *   2. Reuse a persistent BrowserContext across all bids in one cycle
 *   3. Verify session by navigating to /my/ — if redirected to /login mark EXPIRED
 *   4. For each project: navigate, detect state, fill form, submit, confirm
 *   5. Log every step: session loaded, logged in, project parsed, bid submitted/failed
 *   6. Take a /tmp screenshot on any failure
 */

import path from 'path';
import fs from 'fs';
import type { Browser, BrowserContext } from 'playwright';

export type BidLogLevel = 'info' | 'success' | 'warning' | 'error';
export type BidLogFn = (level: BidLogLevel, message: string) => void;

const noop: BidLogFn = () => {};

// ─── Session resolution ───────────────────────────────────────────────────────

/**
 * Resolve the storageState.json path using `path.resolve(process.cwd(), ...)`.
 * Never uses relative paths ("./...") — always absolute.
 * Search order:
 *   1. FREELANCEHUNT_SESSION_PATH env var (explicit override)
 *   2. <cwd>/storageState.json  ← primary: project root on Railway
 *   3. /tmp/storageState.json   ← fallback for ephemeral containers
 */
export function resolveSessionPath(): string | null {
  const cwd = process.cwd();
  const primary = path.resolve(cwd, 'storageState.json');

  const candidates: string[] = [
    ...(process.env.FREELANCEHUNT_SESSION_PATH ? [process.env.FREELANCEHUNT_SESSION_PATH] : []),
    primary,
    '/tmp/storageState.json',
  ];

  // Log diagnostic info on every resolution attempt (visible in Railway logs)
  console.log('[Playwright] resolveSessionPath — cwd:', cwd);
  console.log('[Playwright] resolveSessionPath — primary path:', primary);
  console.log('[Playwright] resolveSessionPath — primary exists:', fs.existsSync(primary));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log('[Playwright] resolveSessionPath — resolved to:', p);
        return p;
      }
    } catch {
      // ignore permission errors
    }
  }

  console.log('[Playwright] resolveSessionPath — NOT FOUND. Candidates checked:', candidates);
  return null;
}

export function sessionExists(): boolean {
  return resolveSessionPath() !== null;
}

// ─── Persistent browser + context (reused across bids in one worker process) ──

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _sessionPath: string | null = null; // track which session is loaded

async function getContext(log: BidLogFn): Promise<BrowserContext> {
  const cwd = process.cwd();
  const storageStatePath = path.resolve(cwd, 'storageState.json');
  const exists = fs.existsSync(storageStatePath);

  console.log('cwd:', cwd);
  console.log('storageStatePath:', storageStatePath);
  console.log('storageState exists:', exists);

  log('info', `[Playwright] getContext — cwd: ${cwd}`);
  log('info', `[Playwright] getContext — storageStatePath: ${storageStatePath}`);
  log('info', `[Playwright] getContext — fs.existsSync(storageStatePath): ${exists}`);

  const sessionPath = resolveSessionPath();
  if (!sessionPath) {
    throw new Error(
      `SESSION_MISSING: storageState.json not found. ` +
      `cwd=${cwd} | primary=${storageStatePath} | exists=${exists}. ` +
      `Run: npm run login:freelancehunt`
    );
  }

  // Re-create context if session file changed or browser disconnected
  const sessionChanged = _sessionPath !== sessionPath;
  if (_browser && !_browser.isConnected()) {
    _browser = null;
    _context = null;
  }

  if (!_browser || !_context || sessionChanged) {
    // Close stale context/browser first
    await _context?.close().catch(() => {});
    await _browser?.close().catch(() => {});
    _context = null;
    _browser = null;

    const resolvedStorageState = path.resolve(process.cwd(), 'storageState.json');
    console.log('cwd:', process.cwd());
    console.log('storageStatePath:', resolvedStorageState);
    console.log('storageState exists:', fs.existsSync(resolvedStorageState));
    log('info', `[Playwright] Loading session — resolved path: ${resolvedStorageState}`);
    log('info', `[Playwright] Session file exists: ${fs.existsSync(resolvedStorageState)}`);

    const { chromium } = await import('playwright');
    _browser = await chromium.launch({
      headless: process.env.NODE_ENV !== 'development',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    _context = await _browser.newContext({
      storageState: resolvedStorageState,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'uk-UA',
      viewport: { width: 1280, height: 900 },
    });

    _sessionPath = resolvedStorageState;
    log('info', `[Playwright] Session loaded — browser context created from ${resolvedStorageState}`);
  }

  return _context;
}

export async function closeBrowser(): Promise<void> {
  await _context?.close().catch(() => {});
  await _browser?.close().catch(() => {});
  _context = null;
  _browser = null;
  _sessionPath = null;
}

// ─── Session verification ─────────────────────────────────────────────────────

export interface SessionVerifyResult {
  valid: boolean;
  username?: string;
  reason?: string;
}

/**
 * Opens freelancehunt.com/my/ with the saved session and checks for redirect.
 * If the page ends up at /login, the session is expired.
 */
export async function verifySession(log: BidLogFn = noop): Promise<SessionVerifyResult> {
  log('info', '[Playwright] Verifying session — opening freelancehunt.com/my/');

  let context: BrowserContext;
  try {
    context = await getContext(log);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('error', `[Playwright] Cannot verify session: ${reason}`);
    return { valid: false, reason };
  }

  const page = await context.newPage();
  try {
    await page.goto('https://freelancehunt.com/my/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const finalUrl = page.url();

    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      log('error', '[Playwright] Session EXPIRED — redirected to login page');
      return { valid: false, reason: 'SESSION_EXPIRED: redirected to login page' };
    }

    // Extract username
    const username = await page.evaluate(() => {
      const selectors = [
        '.header-user-name',
        '[class*="username"]',
        '[class*="user-name"]',
        'nav .name',
        '[data-user-name]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return '';
    }).catch(() => '');

    log('success', `[Playwright] Logged in successfully — user: ${username || 'unknown'}`);
    return { valid: true, username: username || 'authenticated' };
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Bid submission ───────────────────────────────────────────────────────────

export interface PlaywrightBidOptions {
  projectUrl: string;
  text: string;
  budget: number;
  days: number;
  currency?: string;
  logFn?: BidLogFn;
}

export interface PlaywrightBidResult {
  success: boolean;
  strategy: 'playwright';
  bidId?: string;
  screenshotPath?: string;
}

export async function submitBidViaPlaywright(
  opts: PlaywrightBidOptions
): Promise<PlaywrightBidResult> {
  const log = opts.logFn ?? noop;
  const screenshotPath = `/tmp/fh-bid-${Date.now()}.png`;

  // ── 1. Get shared context (loads session once per process) ─────────────────
  const context = await getContext(log);
  const page = await context.newPage();

  try {
    // ── 2. Navigate to project page ──────────────────────────────────────────
    log('info', `[Playwright] Project parsed — navigating to: ${opts.projectUrl}`);
    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const finalUrl = page.url();

    // Session expired mid-cycle
    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      _context = null; // force context re-creation on next bid
      throw new Error('SESSION_EXPIRED: Redirected to login page mid-cycle');
    }

    log('info', `[Playwright] Page loaded: ${await page.title()}`);

    // ── 3. Detect unavailable states ─────────────────────────────────────────
    const pageText = (await page.evaluate(() => document.body.innerText)).slice(0, 3000).toLowerCase();

    const closedPhrases = [
      'проект закрито', 'проект виконано', 'project is closed',
      'project completed', 'завершено', 'виконано',
    ];
    for (const phrase of closedPhrases) {
      if (pageText.includes(phrase)) {
        throw new Error(`PROJECT_CLOSED: "${phrase}" found on page`);
      }
    }

    const alreadyPhrases = [
      'ви вже відгукнулись', 'your bid has been', 'you already applied',
      'ваша заявка', 'заявку подано', 'відгук надіслано',
    ];
    for (const phrase of alreadyPhrases) {
      if (pageText.includes(phrase)) {
        throw new Error(`ALREADY_BID: "${phrase}" found on page`);
      }
    }

    // ── 4. Find and click the bid/apply button ───────────────────────────────
    log('info', '[Playwright] Looking for bid button...');

    const bidButtonSelectors = [
      'button:has-text("Відгукнутись")',
      'button:has-text("Подати заявку")',
      'a:has-text("Відгукнутись")',
      'a:has-text("Подати заявку")',
      'button:has-text("Apply")',
      'button:has-text("Place bid")',
      'a:has-text("Apply")',
      '.bid-button',
      '[data-action="bid"]',
      '.js-bid-form-open',
      '.send-bid',
    ];

    let bidButtonClicked = false;
    for (const sel of bidButtonSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1_500 })) {
          log('info', `[Playwright] Clicking bid button: "${sel}"`);
          await btn.click();
          bidButtonClicked = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (!bidButtonClicked) {
      // Form might already be visible inline
      const inlineFormVisible = await page
        .locator('textarea[name="comment"], textarea[name="body"], textarea[placeholder*="пропоз"]')
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);

      if (!inlineFormVisible) {
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        throw new Error(
          `FORM_NOT_FOUND: No bid button or inline form found on ${opts.projectUrl}. Screenshot: ${screenshotPath}`
        );
      }
      log('info', '[Playwright] Bid form already visible inline');
    }

    // ── 5. Wait for bid form ─────────────────────────────────────────────────
    log('info', '[Playwright] Waiting for bid form...');

    const textareaSelectors = [
      'textarea[name="comment"]',
      'textarea[name="body"]',
      'textarea[name="text"]',
      'textarea[placeholder*="опис"]',
      'textarea[placeholder*="пропоз"]',
      'textarea[placeholder*="Опишіть"]',
      'textarea[placeholder*="Ваша пропозиція"]',
      '.bid-form textarea',
      'form.bid textarea',
      '.modal textarea',
      '[role="dialog"] textarea',
    ];

    let textarea = null;
    for (const sel of textareaSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3_000 })) {
          textarea = el;
          log('info', `[Playwright] Textarea found: "${sel}"`);
          break;
        }
      } catch {
        // try next
      }
    }

    if (!textarea) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `FORM_NOT_FOUND: Textarea not visible after clicking bid button. Screenshot: ${screenshotPath}`
      );
    }

    // ── 6. Fill proposal text ────────────────────────────────────────────────
    log('info', `[Playwright] Filling proposal — ${opts.text.length} chars`);
    await textarea.fill(opts.text);

    // ── 7. Fill budget ────────────────────────────────────────────────────────
    const budgetAmount = Math.max(1, Math.round(opts.budget));
    const budgetSelectors = [
      'input[name="amount"]',
      'input[name="budget"]',
      'input[name="price"]',
      'input[placeholder*="грн"]',
      'input[placeholder*="бюджет"]',
      'input[placeholder*="вартість"]',
      '.bid-form input[type="number"]',
      '.modal input[type="number"]',
      '[role="dialog"] input[type="number"]',
    ];

    let budgetFilled = false;
    for (const sel of budgetSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1_500 })) {
          await el.fill(String(budgetAmount));
          log('info', `[Playwright] Budget ${budgetAmount} filled via "${sel}"`);
          budgetFilled = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!budgetFilled) {
      log('warning', '[Playwright] Budget field not found — continuing without budget');
    }

    // ── 8. Fill deadline days ─────────────────────────────────────────────────
    const daysAmount = Math.max(1, Math.round(opts.days));
    const daysSelectors = [
      'input[name="days"]',
      'input[name="deadline"]',
      'input[name="term"]',
      'input[placeholder*="днів"]',
      'input[placeholder*="термін"]',
      'input[placeholder*="дні"]',
    ];

    let daysFilled = false;
    for (const sel of daysSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1_500 })) {
          await el.fill(String(daysAmount));
          log('info', `[Playwright] Deadline ${daysAmount}d filled via "${sel}"`);
          daysFilled = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!daysFilled) {
      log('warning', '[Playwright] Deadline field not found — continuing without days');
    }

    // ── 9. Submit form ────────────────────────────────────────────────────────
    log('info', '[Playwright] Submitting bid form...');

    const submitSelectors = [
      'button[type="submit"]:has-text("Відправити")',
      'button[type="submit"]:has-text("Подати")',
      'button[type="submit"]:has-text("Надіслати")',
      'button[type="submit"]:has-text("Submit")',
      'button[type="submit"]:has-text("Send")',
      '.bid-form button[type="submit"]',
      'form.bid button[type="submit"]',
      '.modal button[type="submit"]',
      '[role="dialog"] button[type="submit"]',
      'button[type="submit"]',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1_500 })) {
          log('info', `[Playwright] Clicking submit: "${sel}"`);
          await btn.click();
          submitted = true;
          break;
        }
      } catch {
        // try next
      }
    }

    if (!submitted) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(`FORM_NOT_FOUND: Submit button not found. Screenshot: ${screenshotPath}`);
    }

    // ── 10. Confirm success ───────────────────────────────────────────────────
    await page.waitForTimeout(3_000);

    const postText = (await page.evaluate(() => document.body.innerText)).slice(0, 3000).toLowerCase();

    const successPhrases = [
      'заявку подано', 'відгук надіслано', 'ваша заявка',
      'bid submitted', 'application sent', 'дякуємо', 'успішно', 'success',
    ];

    let confirmed = successPhrases.some((p) => postText.includes(p));

    if (!confirmed) {
      // Form closed = implicit success
      const formGone = !(await page
        .locator('textarea[name="comment"], textarea[name="body"]')
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false));

      if (formGone) {
        log('info', '[Playwright] Form closed after submit — treating as success');
        confirmed = true;
      }
    }

    if (!confirmed) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `FORM_NOT_FOUND: No success indicator after submit. Screenshot: ${screenshotPath}`
      );
    }

    log('success', `[Playwright] Bid submitted successfully — ${opts.projectUrl}`);
    return { success: true, strategy: 'playwright' };

  } catch (err) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const enriched = new Error(msg) as Error & { screenshotPath: string };
    enriched.screenshotPath = screenshotPath;
    throw enriched;
  } finally {
    await page.close().catch(() => {});
    // Context stays open — reused for next bid
  }
}
