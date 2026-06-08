import { NextResponse } from 'next/server';

/**
 * GET /api/health/playwright
 *
 * Verifies Playwright can launch Chromium in the current environment.
 * Returns { ok, browser, chromiumVersion } or { ok: false, error, code }.
 *
 * This runs on the Next.js server (Vercel), NOT on Railway — use the worker
 * GET /health?check=browser to test Playwright on Railway.
 */
export async function GET() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });
    const version = browser.version();
    await browser.close();

    return NextResponse.json({
      ok: true,
      browser: 'chromium',
      chromiumVersion: version,
      environment: process.env.NODE_ENV ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes('libglib')    ? 'MISSING_SYSTEM_DEPS'
               : message.includes('ENOENT')      ? 'CHROMIUM_NOT_INSTALLED'
               : message.includes('cannot open') ? 'MISSING_SHARED_LIBS'
               : 'PLAYWRIGHT_BROWSER_ERROR';

    return NextResponse.json(
      {
        ok: false,
        browser: 'chromium',
        code,
        error: message.slice(0, 500),
        hint: code === 'PLAYWRIGHT_BROWSER_ERROR' || code === 'MISSING_SYSTEM_DEPS'
          ? 'Run: npx playwright install --with-deps chromium — or use the official mcr.microsoft.com/playwright Docker image'
          : 'Chromium binary missing — run: npx playwright install chromium',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
