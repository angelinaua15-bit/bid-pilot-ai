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

// ─── Single canonical storageState path ──────────────────────────────────────
// Computed once at module load using path.resolve(process.cwd(), ...).
// Never uses relative paths like "./storageState.json" or "../storageState.json".

const storageStatePath: string = process.env.FREELANCEHUNT_SESSION_PATH
  ? path.resolve(process.env.FREELANCEHUNT_SESSION_PATH)
  : path.resolve(process.cwd(), 'storageState.json');

// Emit diagnostic logs immediately at module load so they appear in Railway logs
// even before any function is called.
console.log('cwd:', process.cwd());
console.log('storageStatePath:', storageStatePath);
console.log('storageState exists:', fs.existsSync(storageStatePath));

// ─── Public helpers ───────────────────────────────────────────────────────────

export function resolveSessionPath(): string {
  return storageStatePath;
}

export function sessionExists(): boolean {
  return fs.existsSync(storageStatePath);
}

// ─── Persistent browser + context (reused across bids in one worker process) ──

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

async function getContext(log: BidLogFn): Promise<BrowserContext> {
  // Log every time we enter getContext so Railway shows the path in context
  console.log('cwd:', process.cwd());
  console.log('storageStatePath:', storageStatePath);
  console.log('storageState exists:', fs.existsSync(storageStatePath));

  log('info', `[Playwright] getContext — storageStatePath: ${storageStatePath}`);
  log('info', `[Playwright] getContext — exists: ${fs.existsSync(storageStatePath)}`);

  if (!fs.existsSync(storageStatePath)) {
    throw new Error(
      `SESSION_MISSING: storageState.json not found at ${storageStatePath}. ` +
      `Run: npm run login:freelancehunt`
    );
  }

  // Re-create context if browser disconnected
  if (_browser && !_browser.isConnected()) {
    _browser = null;
    _context = null;
  }

  if (!_browser || !_context) {
    await _context?.close().catch(() => {});
    await _browser?.close().catch(() => {});
    _context = null;
    _browser = null;

    log('info', `[Playwright] Launching browser — loading session from: ${storageStatePath}`);

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
      storageState: storageStatePath,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'uk-UA',
      viewport: { width: 1280, height: 900 },
    });

    log('info', `[Playwright] Session loaded — browser context created from ${storageStatePath}`);
  }

  return _context;
}

export async function closeBrowser(): Promise<void> {
  await _context?.close().catch(() => {});
  await _browser?.close().catch(() => {});
  _context = null;
  _browser = null;
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

  const context = await getContext(log);
  const page = await context.newPage();

  try {
    // ── 1. Navigate to project page ──────────────────────────────────────────
    log('info', `[Playwright] Project parsed — navigating to: ${opts.projectUrl}`);
    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const finalUrl = page.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      _context = null;
      throw new Error('SESSION_EXPIRED: Redirected to login page mid-cycle');
    }

    const pageTitle = await page.title();
    log('info', `[Playwright] Page loaded: ${pageTitle} — URL: ${page.url()}`);

    // ── 2. Log page snapshot for debugging ───────────────────────────────────
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    log('info', `[Playwright] Page text (first 3000 chars):\n${pageText.slice(0, 3000)}`);

    const pageTextLower = pageText.toLowerCase();

    // ── 3. Detect unavailable states before trying to bid ────────────────────
    if (pageTextLower.includes('/login') || page.url().includes('/login') || page.url().includes('/auth')) {
      _context = null;
      throw new Error('SESSION_EXPIRED: Redirected to login page mid-cycle');
    }

    const closedPhrases = [
      'проект закрито', 'проект виконано', 'project is closed',
      'project completed', 'завершено', 'виконано',
    ];
    for (const phrase of closedPhrases) {
      if (pageTextLower.includes(phrase)) throw new Error(`PROJECT_CLOSED: "${phrase}" found on page`);
    }

    const alreadyPhrases = [
      'ви вже відгукнулись', 'your bid has been', 'you already applied',
      'ваша заявка', 'заявку подано', 'відгук надіслано',
    ];
    for (const phrase of alreadyPhrases) {
      if (pageTextLower.includes(phrase)) throw new Error(`ALREADY_BID: "${phrase}" found on page`);
    }

    // ── 4. Locate and click bid button (robust multi-strategy, 15s total) ────
    log('info', '[Playwright] Looking for bid button...');

    // Strategy A: getByRole with broad text pattern (catches UA/RU/EN labels)
    const roleLocators = [
      page.getByRole('link',   { name: /подати заявку|зробити ставку|відгукнутись|предложить|оставить ставку|bid|apply/i }),
      page.getByRole('button', { name: /подати заявку|зробити ставку|відгукнутись|предложить|оставить ставку|bid|apply/i }),
    ];

    // Strategy B: href/action attribute selectors
    const attrLocators = page.locator(
      'a[href*="bid"], a[href*="proposal"], a[href*="apply"], ' +
      'form[action*="bid"] button[type="submit"], ' +
      'button[type="submit"][form*="bid"]'
    );

    // Strategy C: class / data attribute selectors
    const classLocators = page.locator(
      '.bid-button, .js-bid-form-open, .send-bid, .apply-button, ' +
      '[data-action="bid"], [data-modal="bid"], [data-target*="bid"]'
    );

    // Strategy D: text-based CSS selectors (Playwright :has-text pseudo)
    const cssTextSelectors = [
      'button:has-text("Відгукнутись")',
      'a:has-text("Відгукнутись")',
      'button:has-text("Подати заявку")',
      'a:has-text("Подати заявку")',
      'button:has-text("Зробити ставку")',
      'a:has-text("Зробити ставку")',
      'button:has-text("Предложить услуги")',
      'a:has-text("Предложить услуги")',
      'button:has-text("Оставить ставку")',
      'a:has-text("Оставить ставку")',
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      'button:has-text("Bid")',
      'a:has-text("Bid")',
    ];

    const BUTTON_TIMEOUT_MS = 15_000;
    const deadline = Date.now() + BUTTON_TIMEOUT_MS;

    let bidButtonClicked = false;

    // Check inline form first (sometimes the form is already open on the page)
    const inlineFormAlreadyVisible = await page
      .locator('textarea[name="comment"], textarea[name="body"], textarea[placeholder*="пропоз"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (inlineFormAlreadyVisible) {
      log('info', '[Playwright] Bid form already visible inline — skipping button click');
      bidButtonClicked = true;
    }

    if (!bidButtonClicked) {
      // Try role-based locators
      for (const loc of roleLocators) {
        if (Date.now() > deadline) break;
        try {
          const el = loc.first();
          if (await el.isVisible({ timeout: 1_500 })) {
            const label = await el.textContent().catch(() => '?');
            log('info', `[Playwright] Clicking bid button (role): "${label?.trim()}"`);
            await el.click();
            bidButtonClicked = true;
            break;
          }
        } catch { /* try next */ }
      }
    }

    if (!bidButtonClicked) {
      // Try attribute-based locator
      try {
        if (Date.now() <= deadline) {
          const el = attrLocators.first();
          if (await el.isVisible({ timeout: 1_500 })) {
            const label = await el.textContent().catch(() => '?');
            log('info', `[Playwright] Clicking bid button (attr): "${label?.trim()}"`);
            await el.click();
            bidButtonClicked = true;
          }
        }
      } catch { /* try next */ }
    }

    if (!bidButtonClicked) {
      // Try class/data-attribute locator
      try {
        if (Date.now() <= deadline) {
          const el = classLocators.first();
          if (await el.isVisible({ timeout: 1_500 })) {
            const label = await el.textContent().catch(() => '?');
            log('info', `[Playwright] Clicking bid button (class): "${label?.trim()}"`);
            await el.click();
            bidButtonClicked = true;
          }
        }
      } catch { /* try next */ }
    }

    if (!bidButtonClicked) {
      // Try CSS text selectors
      for (const sel of cssTextSelectors) {
        if (Date.now() > deadline) break;
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1_000 })) {
            log('info', `[Playwright] Clicking bid button (css): "${sel}"`);
            await el.click();
            bidButtonClicked = true;
            break;
          }
        } catch { /* try next */ }
      }
    }

    if (!bidButtonClicked) {
      // Save HTML snapshot + screenshot for debugging
      const htmlSnapshot = await page.content().catch(() => '');
      const htmlPath = screenshotPath.replace('.png', '.html');
      fs.writeFileSync(htmlPath, htmlSnapshot).valueOf();
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

      log('error', `[Playwright] Bid button NOT FOUND — URL: ${page.url()}`);
      log('error', `[Playwright] Screenshot: ${screenshotPath}`);
      log('error', `[Playwright] HTML snapshot: ${htmlPath}`);
      log('error', `[Playwright] Page text sample: ${pageText.slice(0, 500)}`);

      throw new Error(
        `FORM_NOT_FOUND: No bid button found on ${opts.projectUrl} within ${BUTTON_TIMEOUT_MS / 1000}s. ` +
        `Screenshot: ${screenshotPath}`
      );
    }

    // ── 4. Wait for textarea ──────────────────────────────────────────────────
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
      } catch { /* try next */ }
    }

    if (!textarea) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(`FORM_NOT_FOUND: Textarea not visible after clicking bid button. Screenshot: ${screenshotPath}`);
    }

    // ── 5. Fill proposal ──────────────────────────────────────────────────────
    log('info', `[Playwright] Filling proposal — ${opts.text.length} chars`);
    await textarea.fill(opts.text);

    // ── 6. Fill budget ────────────────────────────────────────────────────────
    const budgetAmount = Math.max(1, Math.round(opts.budget));
    const budgetSelectors = [
      'input[name="amount"]', 'input[name="budget"]', 'input[name="price"]',
      'input[placeholder*="грн"]', 'input[placeholder*="бюджет"]',
      'input[placeholder*="вартість"]',
      '.bid-form input[type="number"]', '.modal input[type="number"]',
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
      } catch { /* try next */ }
    }
    if (!budgetFilled) log('warning', '[Playwright] Budget field not found — continuing without budget');

    // ── 7. Fill deadline ──────────────────────────────────────────────────────
    const daysAmount = Math.max(1, Math.round(opts.days));
    const daysSelectors = [
      'input[name="days"]', 'input[name="deadline"]', 'input[name="term"]',
      'input[placeholder*="днів"]', 'input[placeholder*="термін"]',
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
      } catch { /* try next */ }
    }
    if (!daysFilled) log('warning', '[Playwright] Deadline field not found — continuing without days');

    // ── 8. Submit ─────────────────────────────────────────────────────────────
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
      } catch { /* try next */ }
    }

    if (!submitted) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      throw new Error(`FORM_NOT_FOUND: Submit button not found. Screenshot: ${screenshotPath}`);
    }

    // ── 9. Confirm success ────────────────────────────────────────────────────
    await page.waitForTimeout(3_000);

    const postText = (await page.evaluate(() => document.body.innerText)).slice(0, 3000).toLowerCase();
    const successPhrases = [
      'заявку подано', 'відгук надіслано', 'ваша заявка',
      'bid submitted', 'application sent', 'дякуємо', 'успішно', 'success',
    ];

    let confirmed = successPhrases.some((p) => postText.includes(p));

    if (!confirmed) {
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
      throw new Error(`FORM_NOT_FOUND: No success indicator after submit. Screenshot: ${screenshotPath}`);
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
  }
}

// ─── Project feed parser ──────────────────────────────────────────────────────

export interface FeedProject {
  id: string;
  title: string;
  projectUrl: string;
  description: string;
  budget: number;
  currency: string;
  skills: string[];
  publishedAt: string;
}

/**
 * Parse the project feed from https://freelancehunt.com/projects using the
 * authenticated Playwright session. Returns up to 50 projects.
 */
export async function parseProjectsFromFeed(log: BidLogFn = noop): Promise<FeedProject[]> {
  const context = await getContext(log);
  const page = await context.newPage();

  try {
    log('info', '[Parser] Opening https://freelancehunt.com/projects');
    await page.goto('https://freelancehunt.com/projects', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const finalUrl = page.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      _context = null;
      throw new Error('SESSION_EXPIRED: Redirected to login while loading project feed');
    }

    // Wait for at least one project row to appear
    await page.waitForSelector(
      'tr.project, .project-item, [class*="project"], .project-list tr, tbody tr',
      { timeout: 15_000 }
    ).catch(() => {});

    const projects = await page.evaluate((): FeedProject[] => {
      const results: FeedProject[] = [];
      const now = new Date().toISOString();

      // Try table rows first (freelancehunt uses a <table> layout)
      const rows = Array.from(
        document.querySelectorAll('tr.project, .project-item, tbody tr')
      );

      for (const row of rows) {
        try {
          // Title + URL
          const link = (
            row.querySelector('a.visitable') ??
            row.querySelector('a[href*="/project/"]') ??
            row.querySelector('td a')
          ) as HTMLAnchorElement | null;

          if (!link?.href || !link.href.includes('/project/')) continue;

          const title = link.textContent?.trim() ?? '';
          if (!title) continue;

          const projectUrl = link.href.startsWith('http')
            ? link.href
            : `https://freelancehunt.com${link.href}`;

          // Extract numeric ID from URL: /project/slug/12345.html
          const idMatch = projectUrl.match(/\/(\d{4,})(?:\.html)?(?:[/?#]|$)/);
          const id = idMatch ? `fh_${idMatch[1]}` : `fh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          // Description / details cell
          const descEl =
            row.querySelector('.description') ??
            row.querySelector('td:nth-child(2)');
          const description = descEl?.textContent?.trim().slice(0, 500) ?? '';

          // Budget
          const budgetEl =
            row.querySelector('.budget') ??
            row.querySelector('[class*="budget"]') ??
            row.querySelector('td:nth-child(3)');
          const budgetText = budgetEl?.textContent?.trim() ?? '0';
          const budgetNum = Number(budgetText.replace(/[^\d]/g, '')) || 0;

          // Currency
          const currency = budgetText.includes('$') ? 'USD'
            : budgetText.includes('€') ? 'EUR'
            : 'UAH';

          // Skills / tags
          const skillEls = Array.from(
            row.querySelectorAll('.skill, .tag, [class*="skill"], [class*="tag"]')
          );
          const skills = skillEls
            .map((el) => el.textContent?.trim() ?? '')
            .filter(Boolean)
            .slice(0, 10);

          results.push({ id, title, projectUrl, description, budget: budgetNum, currency, skills, publishedAt: now });
        } catch {
          // skip malformed row
        }
      }

      return results;
    }) as FeedProject[];

    log('info', `[Parser] Parsed ${projects.length} projects from feed`);
    for (const p of projects.slice(0, 5)) {
      log('info', `[Parser] project parsed — "${p.title}" | ${p.budget} ${p.currency} | ${p.projectUrl}`);
    }

    return projects;
  } finally {
    await page.close().catch(() => {});
  }
}
