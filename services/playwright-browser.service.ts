/**
 * services/playwright-browser.service.ts
 *
 * Bid submission via Playwright browser automation.
 * Used because POST /v2/projects/{id}/bids was removed (410 Gone) in API v2.
 *
 * Flow:
 *   1. Launch headless Chromium with saved storageState (authenticated session)
 *   2. Navigate to the project page
 *   3. Detect if bid already submitted, project closed, or form unavailable
 *   4. Click the "Apply" / bid button to open the form
 *   5. Fill proposal text, budget amount, deadline days
 *   6. Submit and verify success confirmation
 *   7. Take screenshot on any failure for debugging
 *
 * Authentication: storageState.json saved by `npm run login:freelancehunt`
 *
 * Every step is logged via logFn so the orchestrator can surface real-time
 * progress in the Logs screen and Telegram notifications.
 */

import path from 'path';
import fs from 'fs';
import type { Browser, BrowserContext, Page } from 'playwright';

export type BidLogLevel = 'info' | 'success' | 'warning' | 'error';
export type BidLogFn = (level: BidLogLevel, message: string) => void;

const noop: BidLogFn = () => {};

// ─── Session resolution ───────────────────────────────────────────────────────

const SESSION_SEARCH_PATHS = [
  // Railway / production: next to the worker binary
  path.resolve(process.cwd(), 'storageState.json'),
  // Local dev: project root
  path.resolve(process.cwd(), '..', 'storageState.json'),
  // Explicit env override
  ...(process.env.FREELANCEHUNT_SESSION_PATH ? [process.env.FREELANCEHUNT_SESSION_PATH] : []),
  // /tmp for container environments
  '/tmp/storageState.json',
];

export function resolveSessionPath(): string | null {
  for (const p of SESSION_SEARCH_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function sessionExists(): boolean {
  return resolveSessionPath() !== null;
}

// ─── Browser lifecycle ────────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(log: BidLogFn): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  log('info', '[Playwright] Launching headless Chromium...');
  const { chromium } = await import('playwright');

  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
    ],
  });

  log('info', '[Playwright] Browser launched');
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

// ─── Main bid submission ──────────────────────────────────────────────────────

export interface PlaywrightBidOptions {
  projectUrl: string;
  text: string;
  budget: number;
  days: number;
  currency?: string;
  logFn?: BidLogFn;
  screenshotDir?: string;
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
  const screenshotDir = opts.screenshotDir ?? '/tmp';

  // ── 1. Validate session ────────────────────────────────────────────────────
  const sessionPath = resolveSessionPath();
  if (!sessionPath) {
    const searched = SESSION_SEARCH_PATHS.join(', ');
    throw new Error(
      `FORM_NOT_FOUND: No storageState.json session file found. ` +
      `Searched: ${searched}. Run: npm run login:freelancehunt`
    );
  }
  log('info', `[Playwright] Session file: ${sessionPath}`);

  // ── 2. Launch browser + context ────────────────────────────────────────────
  const browser = await getBrowser(log);
  const context: BrowserContext = await browser.newContext({
    storageState: sessionPath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'uk-UA',
    viewport: { width: 1280, height: 900 },
  });
  const page: Page = await context.newPage();

  const screenshotPath = path.join(
    screenshotDir,
    `fh-bid-${Date.now()}.png`
  );

  try {
    // ── 3. Navigate to project page ──────────────────────────────────────────
    log('info', `[Playwright] Navigating to: ${opts.projectUrl}`);
    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    log('info', `[Playwright] Page title: ${await page.title()}`);

    // ── 4. Detect unavailable states ─────────────────────────────────────────
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 2000));

    const closedPhrases = [
      'проект закрито', 'проект виконано', 'project is closed',
      'project completed', 'завершено', 'виконано',
    ];
    for (const phrase of closedPhrases) {
      if (pageText.toLowerCase().includes(phrase)) {
        throw new Error(`PROJECT_CLOSED: Page text contains "${phrase}"`);
      }
    }

    const alreadyPhrases = [
      'ви вже відгукнулись', 'your bid has been', 'you already applied',
      'ваша заявка', 'заявку подано', 'відгук надіслано',
    ];
    for (const phrase of alreadyPhrases) {
      if (pageText.toLowerCase().includes(phrase)) {
        throw new Error(`ALREADY_BID: Page text contains "${phrase}"`);
      }
    }

    // ── 5. Find and click the bid/apply button ───────────────────────────────
    log('info', '[Playwright] Looking for bid button...');

    const bidButtonSelectors = [
      // Ukrainian UI
      'button:has-text("Відгукнутись")',
      'button:has-text("Подати заявку")',
      'a:has-text("Відгукнутись")',
      'a:has-text("Подати заявку")',
      // English UI fallback
      'button:has-text("Apply")',
      'button:has-text("Place bid")',
      'a:has-text("Apply")',
      // Generic class selectors
      '.bid-button',
      '[data-action="bid"]',
      '.js-bid-form-open',
      '.send-bid',
    ];

    let bidButtonClicked = false;
    for (const sel of bidButtonSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        log('info', `[Playwright] Clicking bid button: "${sel}"`);
        await btn.click();
        bidButtonClicked = true;
        break;
      }
    }

    if (!bidButtonClicked) {
      // Form might already be visible inline — check for it before failing
      const formVisible = await page.locator('textarea[name="comment"], textarea[name="body"], textarea[placeholder*="опис"], textarea[placeholder*="пропоз"]')
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);

      if (!formVisible) {
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        throw new Error(
          `FORM_NOT_FOUND: Could not find bid button or inline form on ${opts.projectUrl}. Screenshot: ${screenshotPath}`
        );
      }
      log('info', '[Playwright] Bid form is already visible inline');
    }

    // ── 6. Wait for bid form to appear ───────────────────────────────────────
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
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
        textarea = el;
        log('info', `[Playwright] Found textarea: "${sel}"`);
        break;
      }
    }

    if (!textarea) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `FORM_NOT_FOUND: Bid form textarea not found after clicking button. Screenshot: ${screenshotPath}`
      );
    }

    // ── 7. Fill proposal text ────────────────────────────────────────────────
    log('info', `[Playwright] Filling proposal text (${opts.text.length} chars)`);
    await textarea.fill(opts.text);

    // ── 8. Fill budget ────────────────────────────────────────────────────────
    const budgetAmount = Math.max(1, Math.round(opts.budget));
    log('info', `[Playwright] Filling budget: ${budgetAmount}`);

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
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await el.fill(String(budgetAmount));
        log('info', `[Playwright] Budget filled via "${sel}"`);
        budgetFilled = true;
        break;
      }
    }

    if (!budgetFilled) {
      log('warning', '[Playwright] Budget field not found — skipping budget fill');
    }

    // ── 9. Fill deadline days ─────────────────────────────────────────────────
    const daysAmount = Math.max(1, Math.round(opts.days));
    log('info', `[Playwright] Filling deadline: ${daysAmount} days`);

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
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await el.fill(String(daysAmount));
        log('info', `[Playwright] Days filled via "${sel}"`);
        daysFilled = true;
        break;
      }
    }

    if (!daysFilled) {
      log('warning', '[Playwright] Deadline field not found — skipping days fill');
    }

    // ── 10. Submit the form ───────────────────────────────────────────────────
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
      // Fallback: any submit button in the form
      'button[type="submit"]',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        log('info', `[Playwright] Clicking submit button: "${sel}"`);
        await btn.click();
        submitted = true;
        break;
      }
    }

    if (!submitted) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `FORM_NOT_FOUND: Submit button not found. Screenshot: ${screenshotPath}`
      );
    }

    // ── 11. Wait for navigation / success confirmation ────────────────────────
    log('info', '[Playwright] Waiting for post-submit response...');

    // Wait briefly for page update
    await page.waitForTimeout(3_000);

    const postSubmitText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    log('info', `[Playwright] Post-submit page text (first 300 chars): ${postSubmitText.slice(0, 300)}`);

    // Check for error indicators
    const errorPhrases = [
      'помилка', 'error', 'невірно', 'не вдалось', 'failed',
      'invalid', 'required', "обов'язков",
    ];
    for (const phrase of errorPhrases) {
      if (postSubmitText.toLowerCase().includes(phrase)) {
        // Could be a validation message — take screenshot for review
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        log('warning', `[Playwright] Possible error on page after submit: "${phrase}". Screenshot: ${screenshotPath}`);
        // Don't throw yet — check for success too
      }
    }

    // Check for success indicators
    const successPhrases = [
      'заявку подано', 'відгук надіслано', 'ваша заявка',
      'bid submitted', 'application sent', 'дякуємо',
      'успішно', 'success',
    ];
    let confirmed = false;
    for (const phrase of successPhrases) {
      if (postSubmitText.toLowerCase().includes(phrase)) {
        log('success', `[Playwright] Success confirmed by page text: "${phrase}"`);
        confirmed = true;
        break;
      }
    }

    if (!confirmed) {
      // Form may have closed / redirected — check if textarea is gone (typical success)
      const textareaGone = !(await page.locator('textarea[name="comment"], textarea[name="body"]')
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false));

      if (textareaGone) {
        log('info', '[Playwright] Form closed after submit — treating as success');
        confirmed = true;
      }
    }

    if (!confirmed) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(
        `FORM_NOT_FOUND: Could not confirm bid was submitted. ` +
        `No success indicator found. Screenshot: ${screenshotPath}`
      );
    }

    log('success', `[Playwright] Bid submitted successfully on ${opts.projectUrl}`);
    return { success: true, strategy: 'playwright' };

  } catch (err) {
    // Save screenshot for any unexpected error
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const errMsg = err instanceof Error ? err.message : String(err);

    // Attach screenshot path to the error for upstream logging
    const enriched = new Error(errMsg) as Error & { screenshotPath: string };
    enriched.screenshotPath = screenshotPath;
    throw enriched;

  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
