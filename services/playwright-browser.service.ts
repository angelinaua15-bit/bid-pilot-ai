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
  const ts = Date.now();
  const screenshotPath = `/tmp/fh-bid-${ts}.png`;

  /** Save screenshot + log path — called on every failure point */
  async function saveFailureScreenshot(tag: string): Promise<void> {
    const p = `/tmp/fh-bid-${ts}-${tag}.png`;
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    log('error', `[BID] FAILED screenshot: ${p}`);
  }

  const context = await getContext(log);
  const page = await context.newPage();

  try {
    // ── 1. Navigate to project page ──────────────────────────────────────────
    log('info', `[BID] Opening form — navigating to: ${opts.projectUrl}`);
    await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(800 + Math.random() * 400); // human-like pause

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      _context = null;
      throw new Error('SESSION_EXPIRED: Redirected to login page');
    }

    log('info', `[BID] Page loaded — title: "${await page.title()}" | url: ${currentUrl}`);

    // ── 2. Detect already-applied / project closed ───────────────────────────
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const pt = pageText.toLowerCase();

    // Already bid — skip silently
    const alreadyPhrases = [
      'ви вже відгукнулись', 'you already applied', 'your bid has been',
      'ваша ставка', 'заявку подано', 'відгук надіслано', 'ви вже залишили заявку',
    ];
    for (const phrase of alreadyPhrases) {
      if (pt.includes(phrase)) {
        log('info', `[BID] Already applied — skipping silently (phrase: "${phrase}")`);
        return { success: false, strategy: 'playwright' };
      }
    }

    const closedPhrases = [
      'проект закрито', 'проект виконано', 'project is closed',
      'project completed', 'завершено і закрито',
    ];
    for (const phrase of closedPhrases) {
      if (pt.includes(phrase)) throw new Error(`PROJECT_CLOSED: "${phrase}"`);
    }

    // ── 3. Find and click bid button ─────────────────────────────────────────
    log('info', '[BID] Looking for bid button...');

    // text= matchers — exact intent only, NOT "Ставки N" tabs
    const applyTexts: RegExp[] = [
      /^зробити ставку$/i,
      /^подати заявку$/i,
      /^подати пропозицію$/i,
      /^залишити заявку$/i,
      /^запропонувати послуги$/i,
      /^відгукнутись$/i,
      /^предложить услуги$/i,
      /^оставить ставку$/i,
      /^сделать ставку$/i,
      /^apply$/i,
      /^submit proposal$/i,
      /^place a bid$/i,
    ];

    const skipTexts: RegExp[] = [
      /^ставки\s*\d*$/i,
      /^заявки\s*\d*$/i,
      /^bids\s*\d*$/i,
      /^\d+\s*(ставк|заявк|bid)/i,
    ];

    async function isApplyButton(el: import('playwright').Locator): Promise<boolean> {
      try {
        const raw = (await el.innerText({ timeout: 400 })).trim();
        if (!raw || raw.length > 60) return false;
        if (skipTexts.some((r) => r.test(raw))) return false;
        return applyTexts.some((r) => r.test(raw));
      } catch {
        return false;
      }
    }

    const BUTTON_DEADLINE = Date.now() + 15_000;
    let bidButtonClicked = false;

    // Check if form is already inline-visible (no button needed)
    const inlineForm = await page
      .locator('textarea, input[name*="budget"], input[name*="days"], input[name*="term"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (inlineForm) {
      log('info', '[BID] Form detected inline — skipping button click');
      bidButtonClicked = true;
    }

    if (!bidButtonClicked) {
      const candidateSelectors = ['button', 'a', '[role="button"]', '.bid-button', '.js-bid-form-open', '.send-bid', '[data-action="bid"]'];
      outer: for (const sel of candidateSelectors) {
        if (Date.now() > BUTTON_DEADLINE) break;
        try {
          for (const el of await page.locator(sel).all()) {
            if (Date.now() > BUTTON_DEADLINE) break outer;
            try {
              if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
              if (!(await isApplyButton(el))) continue;
              const label = (await el.innerText({ timeout: 300 }).catch(() => '')).trim();
              log('info', `[BID] Clicking bid button: "${label}" [${sel}]`);
              await el.click({ timeout: 5_000 });
              await page.waitForTimeout(600 + Math.random() * 400);
              bidButtonClicked = true;
              break outer;
            } catch { /* try next */ }
          }
        } catch { /* try next selector */ }
      }
    }

    // Fallback: navigate directly to bid form URL derived from project URL
    if (!bidButtonClicked) {
      const bidUrl = opts.projectUrl.replace(/\.html.*$/, '') + '/bids/new';
      log('warning', `[BID] Button not found — trying direct bid URL: ${bidUrl}`);
      try {
        await page.goto(bidUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(800);
        const afterUrl = page.url();
        if (!afterUrl.includes('/login') && !afterUrl.includes('/auth')) {
          bidButtonClicked = true;
          log('info', `[BID] Direct bid URL loaded: ${afterUrl}`);
        }
      } catch { /* ignore — will fail at form detection */ }
    }

    if (!bidButtonClicked) {
      await saveFailureScreenshot('no-button');
      log('error', `[BID] FAILED — bid button not found on: ${opts.projectUrl}`);
      log('error', `[BID] Page text sample: ${pageText.slice(0, 1000)}`);
      throw new Error(`BID_BUTTON_NOT_FOUND: ${opts.projectUrl}`);
    }

    // ── 4. Wait for bid form — textarea, budget, days ────────────────────────
    log('info', '[BID] Form detected — waiting for fields (max 15s)...');

    const FORM_DEADLINE = Date.now() + 15_000;

    const textareaSelectors = [
      'textarea',
      'textarea[name="comment"]',
      'textarea[name="bid[comment]"]',
      '[name="comment"]',
      '[id*="comment"]',
      '[id*="description"]',
      'textarea[name="body"]',
      'textarea[name="text"]',
      'textarea[placeholder*="пропоз"]',
      'textarea[placeholder*="опис"]',
      '.bid-form textarea',
      '.modal textarea',
      '[role="dialog"] textarea',
    ];

    let textarea: import('playwright').Locator | null = null;
    for (const sel of textareaSelectors) {
      if (Date.now() > FORM_DEADLINE) break;
      try {
        const remaining = Math.max(400, FORM_DEADLINE - Date.now());
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: Math.min(remaining, 3_000) })) {
          textarea = el;
          log('info', `[BID] Form detected — textarea: "${sel}"`);
          break;
        }
      } catch { /* try next */ }
    }

    if (!textarea) {
      await saveFailureScreenshot('no-form');
      log('error', `[BID] FAILED — form not found after 15s. URL: ${page.url()}`);
      throw new Error(`FORM_NOT_FOUND: No bid textarea found on ${opts.projectUrl}`);
    }

    // ── 5. Fill proposal text ─────────────────────────────────────────────────
    log('info', `[BID] Filling proposal — ${opts.text.length} chars`);
    await textarea.click({ timeout: 3_000 });
    await page.waitForTimeout(200 + Math.random() * 200);
    await textarea.fill(opts.text);
    await page.waitForTimeout(300 + Math.random() * 200);

    // ── 6. Fill budget ────────────────────────────────────────────────────────
    const budgetAmount = Math.max(1, Math.round(opts.budget));
    const budgetSelectors = [
      'input[name*="budget"]',
      'input[name="amount"]',
      'input[name="price"]',
      'input[type="number"]',
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
        if (await el.isVisible({ timeout: 1_000 })) {
          await el.click({ timeout: 2_000 });
          await page.waitForTimeout(100);
          await el.fill(String(budgetAmount));
          log('info', `[BID] Budget set: ${budgetAmount} via "${sel}"`);
          budgetFilled = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (!budgetFilled) log('warning', '[BID] Budget field not found — skipping');

    // ── 7. Fill deadline / days ───────────────────────────────────────────────
    const daysAmount = Math.max(1, Math.round(opts.days));
    const daysSelectors = [
      'input[name*="days"]',
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
        if (await el.isVisible({ timeout: 1_000 })) {
          await el.click({ timeout: 2_000 });
          await page.waitForTimeout(100);
          await el.fill(String(daysAmount));
          log('info', `[BID] Deadline set: ${daysAmount}d via "${sel}"`);
          daysFilled = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (!daysFilled) log('warning', '[BID] Deadline field not found — skipping');

    await page.waitForTimeout(400 + Math.random() * 300); // human pause before submit

    // ── 8. Click submit button ────────────────────────────────────────────────
    log('info', '[BID] Clicking submit...');

    const submitSelectors = [
      'button[type="submit"]:has-text("Подати ставку")',
      'button[type="submit"]:has-text("Подати заявку")',
      'button[type="submit"]:has-text("Відправити")',
      'button[type="submit"]:has-text("Надіслати")',
      'button[type="submit"]:has-text("Submit")',
      'button[type="submit"]:has-text("Send")',
      '.bid-form button[type="submit"]',
      'form button[type="submit"]',
      '.modal button[type="submit"]',
      '[role="dialog"] button[type="submit"]',
      'button[type="submit"]',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1_500 })) {
          const label = (await btn.innerText({ timeout: 500 }).catch(() => sel)).trim();
          log('info', `[BID] Clicking submit: "${label}" [${sel}]`);
          await btn.click({ timeout: 5_000 });
          submitted = true;
          break;
        }
      } catch { /* try next */ }
    }

    if (!submitted) {
      await saveFailureScreenshot('no-submit');
      log('error', '[BID] FAILED — submit button not found');
      throw new Error(`SUBMIT_NOT_FOUND: No submit button on ${opts.projectUrl}`);
    }

    // ── 9. Wait for success state ─────────────────────────────────────────────
    log('info', '[BID] Waiting for success confirmation...');
    await page.waitForTimeout(2_500);

    const postText = (await page.evaluate(() => document.body.innerText).catch(() => '')).toLowerCase();
    const successPhrases = [
      'заявку подано', 'ставку подано', 'відгук надіслано', 'ваша ставка',
      'bid submitted', 'application sent', 'дякуємо', 'успішно',
    ];

    let confirmed = successPhrases.some((p) => postText.includes(p));

    if (!confirmed) {
      // URL change is also a success indicator
      const urlChanged = page.url() !== currentUrl;
      if (urlChanged) {
        log('info', `[BID] URL changed after submit — treating as success (new: ${page.url()})`);
        confirmed = true;
      }
    }

    if (!confirmed) {
      // Form disappearing means submission went through
      const formGone = !(await page.locator('textarea').first().isVisible({ timeout: 1_000 }).catch(() => false));
      if (formGone) {
        log('info', '[BID] Form closed after submit — treating as success');
        confirmed = true;
      }
    }

    if (!confirmed) {
      await saveFailureScreenshot('no-confirm');
      log('error', '[BID] FAILED — no success indicator after submit');
      log('error', `[BID] Post-submit page text: ${postText.slice(0, 500)}`);
      throw new Error(`NO_CONFIRM: Bid submitted but no success state detected on ${opts.projectUrl}`);
    }

    log('success', `[BID] SUCCESS — bid submitted: ${opts.projectUrl}`);
    return { success: true, strategy: 'playwright' };

  } catch (err) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    log('error', `[BID] FAILED — ${msg}`);
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
