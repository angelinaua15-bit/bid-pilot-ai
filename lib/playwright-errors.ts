/**
 * lib/playwright-errors.ts
 *
 * Shared, framework-agnostic error vocabulary for everything Playwright-related.
 * Pure module — NO `playwright` import — so it is safe to use from Vercel API
 * routes AND from the Railway worker.
 *
 * Goals:
 *   - The user NEVER sees a raw Playwright stack trace.
 *   - Every failure becomes a small structured object: { success, code, message }.
 *   - Vercel never launches Chromium → WORKER_REQUIRED.
 *   - Missing Chromium on the worker → PLAYWRIGHT_NOT_INSTALLED.
 */

export type PlaywrightErrorCode =
  | 'PLAYWRIGHT_NOT_INSTALLED' // Chromium binary missing on the worker
  | 'WORKER_REQUIRED'         // tried to run Playwright on Vercel / worker not configured
  | 'BROWSER_LAUNCH_FAILED'   // launched but crashed (missing libs, etc.)
  | 'LOGIN_REQUIRED'          // no valid Freelancehunt session
  | 'UNKNOWN';

export interface StructuredError {
  success: false;
  code: PlaywrightErrorCode;
  message: string;
}

/** User-facing (Ukrainian) message for each code. Safe to show in the UI. */
export const PLAYWRIGHT_USER_MESSAGE: Record<PlaywrightErrorCode, string> = {
  PLAYWRIGHT_NOT_INSTALLED: 'Worker не налаштований. Chromium не встановлено на Railway.',
  WORKER_REQUIRED:          'Worker не налаштований. Chromium не встановлено на Railway.',
  BROWSER_LAUNCH_FAILED:    'Не вдалося запустити браузер на worker. Перевірте налаштування Railway.',
  LOGIN_REQUIRED:           'Потрібно перепідключити Freelancehunt — увійдіть через браузер.',
  UNKNOWN:                  'Сталася помилка автоматизації. Спробуйте пізніше.',
};

/** Typed error: Chromium executable is missing on the worker. */
export class PlaywrightNotInstalledError extends Error {
  readonly code: PlaywrightErrorCode = 'PLAYWRIGHT_NOT_INSTALLED';
  constructor(message = 'Chromium не встановлений на worker') {
    super(message);
    this.name = 'PlaywrightNotInstalledError';
  }
}

/** Typed error: Playwright was invoked where it must never run (Vercel). */
export class WorkerRequiredError extends Error {
  readonly code: PlaywrightErrorCode = 'WORKER_REQUIRED';
  constructor(message = 'Playwright must run on the Railway worker, not on Vercel') {
    super(message);
    this.name = 'WorkerRequiredError';
  }
}

/** True when running inside a Vercel function (never launch Chromium here). */
export function isVercelRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.NEXT_RUNTIME === 'edge',
  );
}

/** Recognise the various ways Playwright reports a missing/broken browser binary. */
export function isMissingBrowserError(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err);
  return (
    m.includes("Executable doesn't exist") ||
    m.includes('playwright install') ||
    m.includes('ms-playwright') ||
    (m.includes('ENOENT') && m.includes('chrome'))
  );
}

/** Recognise a launched-but-crashed browser (missing system libraries, etc.). */
export function isBrowserLaunchCrash(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err);
  return (
    m.includes('libglib') ||
    m.includes('cannot open shared object') ||
    m.includes('error while loading shared libraries') ||
    m.includes('Target page, context or browser has been closed')
  );
}

/**
 * Map ANY error into a clean structured object. NEVER includes a stack trace.
 * This is the single function every API/worker catch block should funnel through.
 */
export function toStructuredError(err: unknown): StructuredError {
  // Already-typed errors keep their code.
  if (err instanceof PlaywrightNotInstalledError) {
    return { success: false, code: 'PLAYWRIGHT_NOT_INSTALLED', message: PLAYWRIGHT_USER_MESSAGE.PLAYWRIGHT_NOT_INSTALLED };
  }
  if (err instanceof WorkerRequiredError) {
    return { success: false, code: 'WORKER_REQUIRED', message: PLAYWRIGHT_USER_MESSAGE.WORKER_REQUIRED };
  }
  if (isMissingBrowserError(err)) {
    return { success: false, code: 'PLAYWRIGHT_NOT_INSTALLED', message: PLAYWRIGHT_USER_MESSAGE.PLAYWRIGHT_NOT_INSTALLED };
  }
  if (isBrowserLaunchCrash(err)) {
    return { success: false, code: 'BROWSER_LAUNCH_FAILED', message: PLAYWRIGHT_USER_MESSAGE.BROWSER_LAUNCH_FAILED };
  }
  return { success: false, code: 'UNKNOWN', message: PLAYWRIGHT_USER_MESSAGE.UNKNOWN };
}

/** Map a structured code (e.g. received from the worker) to the user message. */
export function userMessageForCode(code?: string): string {
  if (code && code in PLAYWRIGHT_USER_MESSAGE) {
    return PLAYWRIGHT_USER_MESSAGE[code as PlaywrightErrorCode];
  }
  return PLAYWRIGHT_USER_MESSAGE.UNKNOWN;
}