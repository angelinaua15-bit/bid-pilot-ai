/**
 * services/playwright-browser.service.ts
 *
 * Worker-side Playwright access for Freelancehunt.
 *
 *  - resolveSessionPath() / sessionExists() — legacy global session file helpers
 *    (kept for server.ts compatibility).
 *  - resolveUserSessionPath(userId)         — per-user session file path.
 *  - parseProjectsFromFeed(log)             — scrape the open projects feed.
 *  - getAuthenticatedContext(userId)        — per-user logged-in context built
 *    from the Supabase session (durable). Used by playwright-bid.service.ts.
 *
 * The bid path is PER-USER: each user's storageState is loaded from Supabase
 * (see freelancehunt-session.service.ts). A legacy on-disk session file, if
 * present, is migrated into Supabase on first use.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import {
  getStorageState,
  saveSession,
  markExpired,
  type PlaywrightStorageState,
} from './freelancehunt-session.service';
import {
  PlaywrightNotInstalledError,
  WorkerRequiredError,
  isVercelRuntime,
  isMissingBrowserError,
} from '../lib/playwright-errors';

// ─── Configuration ────────────────────────────────────────────────────────────

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

// ─── Session file helpers (legacy / compatibility) ────────────────────────────

/** Global session file path (legacy single-account mode). */
export function resolveSessionPath(): string {
  return (
    process.env.FREELANCEHUNT_SESSION_PATH ??
    path.resolve(process.cwd(), 'storageState.json')
  );
}

/** Per-user session file path: sessions/freelancehunt_<userId>.json */
export function resolveUserSessionPath(userId?: string): string {
  if (!userId) return resolveSessionPath();
  const dir = path.resolve(process.cwd(), 'sessions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `freelancehunt_${userId}.json`);
}

/** Whether the legacy global session file exists. */
export function sessionExists(): boolean {
  try {
    return fs.existsSync(resolveSessionPath());
  } catch {
    return false;
  }
}

// ─── Shared browser + per-user contexts ───────────────────────────────────────

let _browser: Browser | null = null;
let _browserLaunching: Promise<Browser> | null = null;
const _userContexts = new Map<string, BrowserContext>();

/** Public Chromium-presence check (used by ensureBrowser and health endpoints). */
export function isChromiumInstalled(): boolean {
  try {
    const execPath = chromium.executablePath();
    return Boolean(execPath) && fs.existsSync(execPath);
  } catch {
    return false;
  }
}

/**
 * Launch (or reuse) the shared headless Chromium. Never auto-installs and never
 * leaks a raw Playwright stack trace:
 *   - on Vercel              → WorkerRequiredError       (Playwright runs on the worker only)
 *   - Chromium binary missing → PlaywrightNotInstalledError
 *   - launch crash            → original error (mapped to BROWSER_LAUNCH_FAILED upstream)
 * Every caller wraps this; the worker server converts the typed errors into
 * structured { success, code, message } responses.
 */
async function ensureBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  if (_browserLaunching) return _browserLaunching;

  // Hard guard: Playwright must NEVER launch on Vercel.
  if (isVercelRuntime()) throw new WorkerRequiredError();

  // Pre-flight: structured error instead of a raw "Executable doesn't exist".
  if (!isChromiumInstalled()) throw new PlaywrightNotInstalledError();

  _browserLaunching = (async (): Promise<Browser> => {
    let b: Browser;
    try {
      b = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    } catch (err) {
      _browserLaunching = null;
      if (isMissingBrowserError(err)) throw new PlaywrightNotInstalledError();
      throw err; // launch crash (missing libs) → BROWSER_LAUNCH_FAILED upstream
    }
    b.on('disconnected', () => {
      _browser = null;
      _browserLaunching = null;
      _userContexts.clear();
    });
    _browser = b;
    _browserLaunching = null;
    return b;
  })();

  return _browserLaunching;
}

/**
 * Load a user's storageState: Supabase first, then any legacy on-disk file
 * (which is migrated into Supabase). Returns null if neither exists.
 */
async function loadStorageState(userId: string): Promise<PlaywrightStorageState | null> {
  const fromDb = await getStorageState(userId);
  if (fromDb) return fromDb;

  // Self-heal: migrate a legacy per-user file into Supabase.
  const filePath = resolveUserSessionPath(userId);
  if (fs.existsSync(filePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PlaywrightStorageState;
      await saveSession(userId, state);
      return state;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Per-user authenticated BrowserContext, built from the user's stored
 * storageState. Throws AUTH_STATE_MISSING when the user has no usable session.
 */
export async function getAuthenticatedContext(userId: string): Promise<BrowserContext> {
  if (!userId) throw new Error('USER_ID_REQUIRED: getAuthenticatedContext needs a userId');

  const cached = _userContexts.get(userId);
  if (cached) return cached;

  const storageState = await loadStorageState(userId);
  if (!storageState) {
    throw new Error(`AUTH_STATE_MISSING: no Freelancehunt session for user ${userId}. Reconnect required.`);
  }

  const browser = await ensureBrowser();
  const context = await browser.newContext({ ...CONTEXT_OPTS, storageState });
  context.on('close', () => _userContexts.delete(userId));
  _userContexts.set(userId, context);
  return context;
}

/** A fresh Page on the user's authenticated context. Caller must close it. */
export async function getAuthenticatedPage(userId: string): Promise<Page> {
  const context = await getAuthenticatedContext(userId);
  return context.newPage();
}

/** Drop a user's cached context (e.g. after detecting an expired session). */
export async function closeUserContext(userId: string): Promise<void> {
  const ctx = _userContexts.get(userId);
  _userContexts.delete(userId);
  await ctx?.close().catch(() => {});
}

/** Mark a user's session expired and drop its context. */
export async function invalidateUserSession(userId: string): Promise<void> {
  await markExpired(userId);
  await closeUserContext(userId);
}

/** Release the shared browser (graceful shutdown). */
export async function closeAuthenticatedBrowser(): Promise<void> {
  for (const ctx of _userContexts.values()) {
    await ctx.close().catch(() => {});
  }
  _userContexts.clear();
  await _browser?.close().catch(() => {});
  _browser = null;
  _browserLaunching = null;
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
 * Parse the open projects feed. Uses the global session file when present
 * (logged-in view), otherwise an anonymous context.
 */
export async function parseProjectsFromFeed(log: BrowserLogFn = noop): Promise<FeedProject[]> {
  const browser = await ensureBrowser();
  const globalState = sessionExists() ? resolveSessionPath() : undefined;
  const context = await browser.newContext({
    ...CONTEXT_OPTS,
    ...(globalState ? { storageState: globalState } : {}),
  });
  const page = await context.newPage();

  try {
    log('info', `[Feed] GET ${FEED_URL}`);
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

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
    await context.close().catch(() => {});
  }
}

async function extractFeedRows(page: Page): Promise<
  Array<{
    id: string; title: string; description: string; budget: number;
    currency: string; skills: string[]; projectUrl: string; publishedAt: string;
  }>
> {
  return page.evaluate(() => {
    const out: Array<{
      id: string; title: string; description: string; budget: number;
      currency: string; skills: string[]; projectUrl: string; publishedAt: string;
    }> = [];
    const seen = new Set<string>();
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/project/"]')
    );

    const idFromHref = (href: string): string => {
      const m = href.match(/\/project\/[^/]+\/(\d+)\.html/) ?? href.match(/\/project\/(\d+)/);
      return m ? m[1] : '';
    };
    const parseMoney = (text: string): { amount: number; currency: string } => {
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
      if (!title) continue;
      seen.add(id);

      const row = a.closest('tr, li, article, .project, [class*="project"]') ?? a.parentElement;
      const rowText = row?.textContent ?? '';
      const money = parseMoney(rowText);
      const skills = Array.from(
        row?.querySelectorAll('a[href*="/projects/skill/"], .skill, [class*="skill"]') ?? []
      ).map((s) => (s.textContent ?? '').trim()).filter(Boolean).slice(0, 12);
      const timeEl = row?.querySelector('time');
      const publishedAt = timeEl?.getAttribute('datetime') ?? new Date().toISOString();

      out.push({
        id, title, description: '',
        budget: money.amount, currency: money.currency,
        skills, projectUrl: href.split('?')[0], publishedAt,
      });
    }
    return out;
  });
}