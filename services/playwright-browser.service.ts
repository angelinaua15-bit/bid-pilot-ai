/**
 * services/playwright-browser.service.ts
 *
 * One authenticated Freelancehunt browser session for the whole worker.
 *
 * A single Chromium browser + BrowserContext is launched lazily from the saved
 * storageState and reused by EVERY consumer:
 *   - parseProjectsFromFeed()   — reads the projects feed
 *   - submitBidViaBrowser()     — places bids (services/playwright-bid.service.ts)
 *
 * Both run on the same logged-in context. No second login, no throwaway browser.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

// ─── Session configuration ────────────────────────────────────────────────────

/**
 * Resolve the session file path.
 * Priority (highest to lowest):
 *   1. per-user:  sessions/freelancehunt_<userId>.json
 *   2. env var:   FH_STORAGE_STATE or FREELANCEHUNT_SESSION_PATH
 *   3. legacy:    storageState.json at project root
 */
export function resolveSessionPath(userId?: string): string {
  if (userId) {
    const sessionsDir = path.resolve(process.cwd(), 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      try { fs.mkdirSync(sessionsDir, { recursive: true }); } catch { /* ignore */ }
    }
    return path.join(sessionsDir, `freelancehunt_${userId}.json`);
  }
  return (
    process.env.FH_STORAGE_STATE ??
    process.env.FREELANCEHUNT_SESSION_PATH ??
    path.resolve(process.cwd(), 'storageState.json')
  );
}

/** Returns true when the session file for the given userId (or global) exists. */
export function sessionExists(userId?: string): boolean {
  return fs.existsSync(resolveSessionPath(userId));
}

/**
 * Path to the saved storageState (cookies + localStorage of the logged-in
 * Freelancehunt account). Set FH_STORAGE_STATE in the environment to override.
 * This must be the file written when the account is connected.
 */
const STORAGE_STATE_PATH =
  process.env.FH_STORAGE_STATE ??
  process.env.FREELANCEHUNT_SESSION_PATH ??
  path.resolve(process.cwd(), 'storageState.json');

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
];

const CONTEXT_OPTS = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'uk-UA',
  viewport: { width: 1280, height: 900 },
} as const;

const FEED_URL = 'https://freelancehunt.com/projects';

export type BrowserLogFn = (
  level: 'info' | 'success' | 'warning' | 'error',
  message: string
) => void;

const noop: BrowserLogFn = () => {};

// ─── Shared authenticated context (singleton) ─────────────────────────────────

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _launching: Promise<BrowserContext> | null = null;

/**
 * Returns the one shared authenticated BrowserContext, launching it once from
 * storageState. Concurrent callers await the same launch. Throws
 * AUTH_STATE_MISSING when no saved session exists — surface that to the user as
 * "reconnect your Freelancehunt account", never as a silent failure.
 */
export async function getAuthenticatedContext(): Promise<BrowserContext> {
  if (_context) return _context;
  if (_launching) return _launching;

  _launching = (async () => {
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      _launching = null;
      throw new Error(
        `AUTH_STATE_MISSING: no saved Freelancehunt session at ${STORAGE_STATE_PATH}. Reconnect the account.`
      );
    }

    const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const context = await browser.newContext({
      ...CONTEXT_OPTS,
      storageState: STORAGE_STATE_PATH,
    });

    browser.on('disconnected', () => {
      _browser = null;
      _context = null;
      _launching = null;
    });

    _browser = browser;
    _context = context;
    _launching = null;
    return context;
  })();

  return _launching;
}

/** A fresh Page on the shared authenticated context. Caller must close it. */
export async function getAuthenticatedPage(): Promise<Page> {
  const context = await getAuthenticatedContext();
  return context.newPage();
}

/**
 * Create a one-shot BrowserContext for a specific user's saved session.
 * Unlike the global singleton, this context is NOT shared or cached —
 * the caller must close it after use.
 *
 * Throws AUTH_STATE_MISSING when the per-user session file does not exist.
 */
export async function getAuthenticatedContextForUser(
  userId: string
): Promise<{ context: import('playwright').BrowserContext; browser: import('playwright').Browser }> {
  const sessionPath = resolveSessionPath(userId);

  if (!fs.existsSync(sessionPath)) {
    throw new Error(
      `AUTH_STATE_MISSING: no saved session for user ${userId} at ${sessionPath}. Reconnect the Freelancehunt account.`
    );
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const context = await browser.newContext({
    ...CONTEXT_OPTS,
    storageState: sessionPath,
  });

  return { context, browser };
}

/**
 * Save a Playwright storageState for a specific user.
 * Used by the connect-save API after the user completes in-browser login.
 */
export async function saveSessionForUser(
  userId: string,
  state: unknown
): Promise<{ sessionPath: string; cookieCount: number }> {
  const sessionPath = resolveSessionPath(userId);
  const json = typeof state === 'string' ? state : JSON.stringify(state);
  fs.writeFileSync(sessionPath, json, 'utf-8');

  let cookieCount = 0;
  try {
    const parsed = JSON.parse(json) as { cookies?: unknown[] };
    cookieCount = parsed.cookies?.length ?? 0;
  } catch { /* ignore */ }

  return { sessionPath, cookieCount };
}

/** Release the shared browser (call on graceful shutdown). */
export async function closeAuthenticatedBrowser(): Promise<void> {
  try {
    await _context?.close();
  } catch {
    /* ignore */
  }
  try {
    await _browser?.close();
  } catch {
    /* ignore */
  }
  _context = null;
  _browser = null;
  _launching = null;
}

// ─── Feed parsing ─────────────────────────────────────────────────────────────

export interface FeedProject {
  id: string; // "fh_299170"
  title: string;
  description: string;
  budget: number;
  currency: string;
  skills: string[];
  projectUrl: string;
  publishedAt: string;
}

/**
 * Parse the open projects feed using the shared authenticated session.
 * The scraping core is isolated in `extractFeedRows`, which runs inside the
 * logged-in page and returns plain rows.
 */
export async function parseProjectsFromFeed(log: BrowserLogFn = noop): Promise<FeedProject[]> {
  const context = await getAuthenticatedContext();
  const page = await context.newPage();

  try {
    log('info', `[Feed] GET ${FEED_URL}`);
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Detect lost session early
    const loggedOut = await page
      .locator('a[href*="/login"]')
      .first()
      .isVisible({ timeout: 1_500 })
      .catch(() => false);
    const hasProjects = await page
      .locator('a[href*="/project/"]')
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false);

    if (loggedOut && !hasProjects) {
      log('error', '[Feed] Login wall — storageState session expired. Reconnect the account.');
      throw new Error('LOGIN_REQUIRED: Freelancehunt session expired (feed)');
    }

    const rows = await extractFeedRows(page);

    const projects: FeedProject[] = rows
      .filter((r) => r.id && r.projectUrl)
      .map((r) => ({
        id: `fh_${r.id}`,
        title: r.title || `project-${r.id}`,
        description: r.description ?? '',
        budget: r.budget ?? 0,
        currency: r.currency || 'UAH',
        skills: r.skills ?? [],
        projectUrl: r.projectUrl,
        publishedAt: r.publishedAt || new Date().toISOString(),
      }));

    log('success', `[Feed] Parsed ${projects.length} project(s) from feed`);
    return projects;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * In-page extraction of project rows from the feed. Returns plain objects.
 * Resilient: matches any /project/.../<id>.html anchor and reads the surrounding
 * row for title, budget and currency.
 */
async function extractFeedRows(page: Page): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    budget: number;
    currency: string;
    skills: string[];
    projectUrl: string;
    publishedAt: string;
  }>
> {
  return page.evaluate(() => {
    const out: Array<{
      id: string;
      title: string;
      description: string;
      budget: number;
      currency: string;
      skills: string[];
      projectUrl: string;
      publishedAt: string;
    }> = [];

    const seen = new Set<string>();
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/project/"]')
    );

    const idFromHref = (href: string): string => {
      const m =
        href.match(/\/project\/[^/]+\/(\d+)\.html/) ??
        href.match(/\/project\/(\d+)/);
      return m ? m[1] : '';
    };

    const parseMoney = (text: string): { amount: number; currency: string } => {
      // e.g. "5 000 грн", "1200 UAH", "300 $"
      const cur =
        /грн|UAH/i.test(text) ? 'UAH' :
        /\$|USD/i.test(text) ? 'USD' :
        /€|EUR/i.test(text) ? 'EUR' :
        /руб|RUB/i.test(text) ? 'RUB' : 'UAH';
      const num = parseInt((text.match(/[\d \u00a0]{2,}/)?.[0] ?? '0').replace(/[ \u00a0]/g, ''), 10);
      return { amount: isNaN(num) ? 0 : num, currency: cur };
    };

    for (const a of anchors) {
      const href = a.href;
      const id = idFromHref(href);
      if (!id || seen.has(id)) continue;

      const title = (a.textContent ?? '').trim();
      if (!title) continue; // skip non-title anchors (icons, etc.)
      seen.add(id);

      // The row container holding this project (best-effort climb)
      const row =
        a.closest('tr, li, article, .project, [class*="project"]') ?? a.parentElement;
      const rowText = row?.textContent ?? '';

      const money = parseMoney(rowText);

      const skills = Array.from(
        row?.querySelectorAll('a[href*="/projects/skill/"], .skill, [class*="skill"]') ?? []
      )
        .map((s) => (s.textContent ?? '').trim())
        .filter(Boolean)
        .slice(0, 12);

      const timeEl = row?.querySelector('time');
      const publishedAt =
        timeEl?.getAttribute('datetime') ?? new Date().toISOString();

      out.push({
        id,
        title,
        description: '',
        budget: money.amount,
        currency: money.currency,
        skills,
        projectUrl: href.split('?')[0],
        publishedAt,
      });
    }

    return out;
  });
}
