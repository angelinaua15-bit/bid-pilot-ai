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
  /** true = submit was clicked but no definitive success signal — treat as sent_unconfirmed, not failed */
  unconfirmed?: boolean;
  strategy: 'playwright';
  bidId?: string;
  screenshotPath?: string;
  /** URL of the page before submit — for logging */
  preSubmitUrl?: string;
  /** URL of the page after submit — for logging */
  postSubmitUrl?: string;
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

    // ── 2. Full page debug snapshot ──────────────────────────────────────────
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const pt = pageText.toLowerCase();
    const nTextareas    = await page.locator('textarea').count().catch(() => 0);
    const nForms        = await page.locator('form').count().catch(() => 0);
    const nContentEdit  = await page.locator('[contenteditable="true"]').count().catch(() => 0);
    const nIframes      = await page.locator('iframe').count().catch(() => 0);
    log('info', `[BID] Snapshot — title:"${await page.title().catch(() => '')}" url:${currentUrl} textareas:${nTextareas} forms:${nForms} contenteditable:${nContentEdit} iframes:${nIframes}`);
    log('info', `[BID] Page text (first 1000): ${pageText.slice(0, 1000)}`);

    // ── 2a. Detect login / session expired ───────────────────────────────────
    const loginPhrases = ['увійти', 'вхід', 'sign in', 'login', 'password', 'email'];
    const hasLoginForm =
      currentUrl.includes('/login') ||
      currentUrl.includes('/auth') ||
      (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
    const loginTextFound = loginPhrases.some((p) => pt.includes(p));

    if (hasLoginForm || (loginTextFound && nForms > 0 && nTextareas === 0)) {
      _context = null;
      const sp = `/tmp/fh-session-expired-${ts}.png`;
      await page.screenshot({ path: sp, fullPage: true }).catch(() => {});
      log('error', `[BID] SESSION_EXPIRED — login page detected. url:${currentUrl} screenshot:${sp}`);
      throw new Error(`SESSION_EXPIRED: Login page at ${currentUrl}`);
    }

    // ── 2b. Detect blocked / unavailable bid states ──────────────────────────
    const unavailablePhrases: Array<[string, string]> = [
      ['неможливо подати заявку', 'UNAVAILABLE'],
      ['неможливо залишити заявку', 'UNAVAILABLE'],
      ['проєкт закрито', 'PROJECT_CLOSED'],
      ['проект закрито', 'PROJECT_CLOSED'],
      ['проект виконано', 'PROJECT_CLOSED'],
      ['project is closed', 'PROJECT_CLOSED'],
      ['project completed', 'PROJECT_CLOSED'],
      ['завершено і закрито', 'PROJECT_CLOSED'],
      ['ставка вже подана', 'ALREADY_BID'],
      ['ви вже відгукнулись', 'ALREADY_BID'],
      ['you already applied', 'ALREADY_BID'],
      ['ваша ставка вже', 'ALREADY_BID'],
      ['відгук надіслано', 'ALREADY_BID'],
      ['ви вже залишили заявку', 'ALREADY_BID'],
      ['потрібно увійти', 'SESSION_EXPIRED'],
      ['необхідно увійти', 'SESSION_EXPIRED'],
      ['доступ заборонено', 'ACCESS_DENIED'],
      ['verify your account', 'VERIFY_REQUIRED'],
      ['account verification', 'VERIFY_REQUIRED'],
      ['account required', 'VERIFY_REQUIRED'],
    ];
    for (const [phrase, code] of unavailablePhrases) {
      if (pt.includes(phrase)) {
        if (code === 'ALREADY_BID') {
          log('info', `[BID] Already applied (phrase:"${phrase}") — skipping silently`);
          return { success: false, strategy: 'playwright' };
        }
        throw new Error(`${code}: "${phrase}" found on ${opts.projectUrl}`);
      }
    }

    // ── 3. Log all buttons and inputs found on the page ──────────────────────
    const buttonLabels = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a[href], [role="button"]'));
      return btns
        .map((b) => (b as HTMLElement).innerText?.trim())
        .filter((t) => t && t.length < 80)
        .slice(0, 30);
    }).catch(() => [] as string[]);
    log('info', `[BID] Buttons on page: ${buttonLabels.join(' | ')}`);

    const inputSelectors = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('textarea, input, [contenteditable]'));
      return els.map((e) => {
        const el = e as HTMLElement;
        return `${e.tagName.toLowerCase()}[name=${(e as HTMLInputElement).name || ''}][id=${el.id}][class=${(el.className || '').split(' ')[0]}]`;
      }).slice(0, 20);
    }).catch(() => [] as string[]);
    log('info', `[BID] Inputs on page: ${inputSelectors.join(' | ')}`);

    // ── 4. Try /bids/new URL directly (primary strategy) ────────────────────
    // Freelancehunt bid form lives at /project/<slug>/bids/new
    const baseProjectUrl = opts.projectUrl.split('?')[0].replace(/\/$/, '');
    const bidUrl = baseProjectUrl.endsWith('/bids/new')
      ? baseProjectUrl
      : `${baseProjectUrl}/bids/new`;

    let bidButtonClicked = false;

    // Check if form already visible inline (e.g. we landed on /bids/new already)
    const inlineTextareaVisible = await page.locator('textarea').first().isVisible({ timeout: 800 }).catch(() => false);
    if (inlineTextareaVisible) {
      log('info', '[BID] Bid form textarea already visible inline — proceeding directly');
      bidButtonClicked = true;
    }

    // Navigate to /bids/new if not already there and form not visible
    if (!bidButtonClicked && !currentUrl.endsWith('/bids/new')) {
      log('info', `[BID] Navigating to bid form URL: ${bidUrl}`);
      try {
        await page.goto(bidUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.waitForTimeout(1_200);
        const afterUrl = page.url();

        if (afterUrl.includes('/login') || afterUrl.includes('/auth')) {
          _context = null;
          throw new Error(`SESSION_EXPIRED: Login page after goto ${bidUrl}`);
        }

        const afterText     = await page.evaluate(() => document.body.innerText).catch(() => '');
        const afterTextareas = await page.locator('textarea').count().catch(() => 0);
        const afterForms     = await page.locator('form').count().catch(() => 0);
        const afterCE        = await page.locator('[contenteditable="true"]').count().catch(() => 0);
        const afterIframes   = await page.locator('iframe').count().catch(() => 0);
        log('info', `[BID] /bids/new snapshot — url:${afterUrl} textareas:${afterTextareas} forms:${afterForms} contenteditable:${afterCE} iframes:${afterIframes}`);
        log('info', `[BID] /bids/new text (first 1000): ${afterText.slice(0, 1000)}`);

        bidButtonClicked = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('SESSION_EXPIRED')) throw err;
        log('warning', `[BID] /bids/new navigation error: ${msg}`);
      }
    }

    // ── 5. Fallback: go back to project page and click the bid button ────────
    if (!bidButtonClicked || !(await page.locator('textarea, [contenteditable="true"]').first().isVisible({ timeout: 1_000 }).catch(() => false))) {
      log('warning', `[BID] No form visible — falling back to project page button click`);
      try {
        await page.goto(opts.projectUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.waitForTimeout(1_000);

        const applyTexts: RegExp[] = [
          /подати\s+заявку/i, /зробити\s+ставку/i, /відгукнутись/i,
          /відгукнутися/i, /залишити\s+заявку/i, /запропонувати\s+послуги/i,
          /предложить\s+услуги/i, /оставить\s+ставку/i, /сделать\s+ставку/i,
          /^apply$/i, /^bid$/i, /submit\s+proposal/i,
        ];
        const skipTexts: RegExp[] = [/^ставки\s*\d*/i, /^заявки\s*\d*/i, /^bids\s*\d*/i];

        const candidates = ['button', 'a', '[role="button"]', '.bid-button', '.js-bid-form-open'];
        outerBtn: for (const sel of candidates) {
          for (const el of await page.locator(sel).all().catch(() => [])) {
            try {
              if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
              const raw = (await el.innerText({ timeout: 400 }).catch(() => '')).trim();
              if (!raw || raw.length > 80) continue;
              if (skipTexts.some((r) => r.test(raw))) continue;
              if (!applyTexts.some((r) => r.test(raw))) continue;
              log('info', `[BID] Clicking bid button: "${raw}" [${sel}]`);
              await el.click({ timeout: 5_000 });
              await page.waitForTimeout(1_000);
              bidButtonClicked = true;
              break outerBtn;
            } catch { /* try next */ }
          }
        }
      } catch (err) {
        log('warning', `[BID] Project page fallback error: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ── 6. Wait for bid form (textarea / rich editor / iframe) — 30s ─────────
    log('info', '[BID] Waiting for bid form (max 30s)...');
    const FORM_DEADLINE = Date.now() + 30_000;

    const textareaSelectors = [
      'textarea[name="comment"]',
      'textarea[name="bid[comment]"]',
      'textarea[name="message"]',
      'textarea[name="body"]',
      'textarea[name="text"]',
      '[name="comment"]',
      '[id*="comment"]',
      '[id*="description"]',
      'textarea[placeholder*="пропоз"]',
      'textarea[placeholder*="Ваша пропозиц"]',
      'textarea[placeholder*="опис"]',
      'textarea.form-control',
      '.bid-form textarea',
      '.modal textarea',
      '[role="dialog"] textarea',
      'form textarea',
      // Rich text editors
      '[contenteditable="true"]',
      '[role="textbox"]',
      'div.ProseMirror',
      '.ql-editor',
      'textarea',  // last resort
    ];

    type EditorHandle =
      | { kind: 'locator'; loc: import('playwright').Locator }
      | { kind: 'iframe'; frameUrl: string };

    let editorHandle: EditorHandle | null = null;

    for (const sel of textareaSelectors) {
      if (Date.now() > FORM_DEADLINE) break;
      try {
        const remaining = Math.max(600, FORM_DEADLINE - Date.now());
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: Math.min(remaining, 3_000) })) {
          editorHandle = { kind: 'locator', loc: el };
          log('info', `[BID] Editor found: "${sel}" url:${page.url()}`);
          break;
        }
      } catch { /* try next */ }
    }

    // If no editor found, try iframes (TinyMCE / CKEditor)
    if (!editorHandle) {
      const iframeCount = await page.locator('iframe').count().catch(() => 0);
      log('info', `[BID] Checking ${iframeCount} iframe(s) for editor...`);
      for (let fi = 0; fi < iframeCount && Date.now() < FORM_DEADLINE; fi++) {
        try {
          const frame = page.frameLocator(`iframe:nth-child(${fi + 1})`);
          const body  = frame.locator('body');
          if (await body.isVisible({ timeout: 2_000 }).catch(() => false)) {
            editorHandle = { kind: 'iframe', frameUrl: `iframe[${fi}]` };
            log('info', `[BID] TinyMCE/CKEditor iframe found at index ${fi}`);
            break;
          }
        } catch { /* try next */ }
      }
    }

    if (!editorHandle) {
      // Final debug: dump everything on the page
      const finalTextareas = await page.locator('textarea').count().catch(() => 0);
      const finalForms     = await page.locator('form').count().catch(() => 0);
      const finalText      = await page.evaluate(() => document.body.innerText).catch(() => '');
      await saveFailureScreenshot('no-form');
      log('error', `[BID] FORM_NOT_FOUND after 30s — url:${page.url()} title:"${await page.title().catch(() => '')}" textareas:${finalTextareas} forms:${finalForms}`);
      log('error', `[BID] Page body (800 chars): ${finalText.slice(0, 800)}`);
      throw new Error(`FORM_NOT_FOUND: No bid textarea/editor found on ${opts.projectUrl}`);
    }

    // ── 7. Fill proposal text ─────────────────────────────────────────────────
    log('info', `[BID] Filling proposal — ${opts.text.length} chars`);

    if (editorHandle.kind === 'iframe') {
      // TinyMCE / CKEditor: fill via iframe body
      const iframeIndex = parseInt((editorHandle.frameUrl.match(/\d+/) ?? ['0'])[0]);
      const frame = page.frameLocator(`iframe:nth-child(${iframeIndex + 1})`);
      const body  = frame.locator('body');
      await body.click({ timeout: 3_000 });
      await page.waitForTimeout(200);
      await body.fill(opts.text);
    } else {
      const textarea = editorHandle.loc;
      await textarea.click({ timeout: 3_000 });
      await page.waitForTimeout(200 + Math.random() * 200);
      // For [contenteditable] use type(), for textarea use fill()
      const tag = await textarea.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'textarea');
      if (tag === 'textarea') {
        await textarea.fill(opts.text);
      } else {
        await textarea.selectText().catch(() => {});
        await textarea.type(opts.text, { delay: 10 });
      }
    }
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

    // ── 9. Confirm outcome — do NOT mark as failed just because success text is absent ─
    log('info', '[BID] Waiting for post-submit navigation (up to 30s)...');

    // Save pre-submit URL for comparison
    const preSubmitUrl = currentUrl;

    // Wait for either network idle or a URL change — whichever comes first
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {}),
      page.waitForURL((url) => url.toString() !== preSubmitUrl, { timeout: 30_000 }).catch(() => {}),
      page.waitForTimeout(5_000),   // fallback: at least 5s
    ]);

    const postSubmitUrl  = page.url();
    const postSubmitText = (await page.evaluate(() => document.body.innerText).catch(() => '')).toLowerCase();

    log('info', `[BID] Post-submit — url:${postSubmitUrl} (was:${preSubmitUrl})`);
    log('info', `[BID] Post-submit text (600): ${postSubmitText.slice(0, 600)}`);

    // ── Tier 1: real error signals — only these cause FAILED ─────────────────
    // Captcha / verification / validation / session errors
    const hardErrorPhrases: Array<[string, string]> = [
      ['captcha',                   'CAPTCHA_REQUIRED'],
      ['верифікац',                 'VERIFY_REQUIRED'],
      ['підтвердіть акаунт',        'VERIFY_REQUIRED'],
      ['verify your account',       'VERIFY_REQUIRED'],
      ['заповніть поле',            'VALIDATION_ERROR'],
      ['це поле обов',              'VALIDATION_ERROR'],
      ['помилка',                   'FORM_ERROR'],
      ['неможливо подати',          'UNAVAILABLE'],
      ['неможливо залишити',        'UNAVAILABLE'],
      ['недостатньо коштів',        'INSUFFICIENT_FUNDS'],
      ['insufficient funds',        'INSUFFICIENT_FUNDS'],
      ['you already applied',       'ALREADY_BID'],
      ['вже подали заявку',         'ALREADY_BID'],
      ['ставка вже подана',         'ALREADY_BID'],
      ['login required',            'SESSION_EXPIRED'],
      ['потрібно увійти',           'SESSION_EXPIRED'],
      ['увійдіть',                  'SESSION_EXPIRED'],
    ];

    for (const [phrase, code] of hardErrorPhrases) {
      if (postSubmitText.includes(phrase)) {
        if (code === 'ALREADY_BID') {
          log('info', `[BID] Already bid detected post-submit ("${phrase}") — skipping silently`);
          return { success: false, strategy: 'playwright', preSubmitUrl, postSubmitUrl };
        }
        await saveFailureScreenshot(`error-${code.toLowerCase()}`);
        log('error', `[BID] REAL ERROR after submit — ${code}: "${phrase}" | url:${postSubmitUrl}`);
        throw new Error(`${code}: "${phrase}" detected after submit on ${opts.projectUrl}`);
      }
    }

    // ── Tier 2: positive confirmation phrases → sent ──────────────────────────
    const successPhrases = [
      'заявку подано', 'ставку подано', 'ставку додано', 'додано ставку',
      'відгук надіслано', 'відгук відправлено', 'заявку надіслано',
      'proposal submitted', 'bid submitted', 'application sent',
      'дякуємо', 'успішно', 'your bid',
    ];
    const hasSuccessText = successPhrases.some((p) => postSubmitText.includes(p));
    if (hasSuccessText) {
      log('success', `[BID] CONFIRMED by success text — url:${postSubmitUrl}`);
      return { success: true, strategy: 'playwright', preSubmitUrl, postSubmitUrl };
    }

    // ── Tier 3: redirect away from /bids/new → sent ───────────────────────────
    const urlChanged = postSubmitUrl !== preSubmitUrl;
    const leftBidForm = preSubmitUrl.includes('/bids/new') && !postSubmitUrl.includes('/bids/new');
    if (urlChanged && leftBidForm) {
      log('success', `[BID] CONFIRMED by redirect from /bids/new — new url:${postSubmitUrl}`);
      return { success: true, strategy: 'playwright', preSubmitUrl, postSubmitUrl };
    }

    // ── Tier 4: form disappeared after submit → sent ──────────────────────────
    const formGone = !(await page.locator('textarea, [contenteditable="true"]').first()
      .isVisible({ timeout: 1_500 }).catch(() => false));
    if (formGone) {
      log('success', `[BID] CONFIRMED by form disappearance — url:${postSubmitUrl}`);
      return { success: true, strategy: 'playwright', preSubmitUrl, postSubmitUrl };
    }

    // ── Tier 5: URL changed at all (any redirect) → sent ─────────────────────
    if (urlChanged) {
      log('success', `[BID] CONFIRMED by any URL change — old:${preSubmitUrl} new:${postSubmitUrl}`);
      return { success: true, strategy: 'playwright', preSubmitUrl, postSubmitUrl };
    }

    // ── Tier 6: submit was clicked, no error found → sent_unconfirmed ─────────
    // Do NOT throw. Do NOT screenshot. Just flag as unconfirmed.
    log('warning', `[BID] SENT_UNCONFIRMED — submit clicked, no error found, no clear success signal | url:${postSubmitUrl}`);
    log('warning', `[BID] Post-submit text snapshot: ${postSubmitText.slice(0, 400)}`);
    return { success: true, unconfirmed: true, strategy: 'playwright', preSubmitUrl, postSubmitUrl };

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

// ─── Project feed parser ────────────────────────────────────────���─────────────

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
