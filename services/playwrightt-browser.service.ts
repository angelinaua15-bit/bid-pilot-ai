/**
 * ADD THESE EXPORTS TO: services/playwright-browser.service.ts
 *
 * Purpose: expose the ONE shared, logged-in Freelancehunt context (built from
 * the saved storageState) so playwright-bid.service.ts can place bids on the
 * SAME session your parser uses — no second login, no throwaway browser.
 *
 * If playwright-browser.service.ts already builds its context internally with
 * storageState, the cleanest move is to have parseProjectsFromFeed ALSO call
 * getAuthenticatedContext() below, so there is exactly one context in the
 * process. Either way, paste this in and adjust STORAGE_STATE_PATH to the same
 * file your parser already loads.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

// ── Point this at the SAME storageState file parseProjectsFromFeed uses ───────
// If your parser already has a constant for it, reuse that instead of this.
const STORAGE_STATE_PATH =
  process.env.FH_STORAGE_STATE ??
  path.resolve(process.cwd(), 'storage/freelancehunt-state.json');

// Same launch args used by the interactive connect flow in server.ts.
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

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

/**
 * Returns the shared authenticated BrowserContext, launching it once (lazily)
 * from the saved storageState. Reused across the parser and the bid submitter.
 * Throws AUTH_STATE_MISSING if the session file is absent — surface this to the
 * user as "reconnect your Freelancehunt account" rather than a silent failure.
 */
export async function getAuthenticatedContext(): Promise<BrowserContext> {
  if (_context) return _context;

  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error(
      `AUTH_STATE_MISSING: no saved Freelancehunt session at ${STORAGE_STATE_PATH}. ` +
        `Reconnect the account so storageState is written.`
    );
  }

  _browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  _context = await _browser.newContext({
    ...CONTEXT_OPTS,
    storageState: STORAGE_STATE_PATH,
  });

  // If the browser dies, reset so the next call relaunches cleanly.
  _browser.on('disconnected', () => {
    _browser = null;
    _context = null;
  });

  return _context;
}

/** Optional: call on graceful shutdown (SIGTERM) to release the browser. */
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
}