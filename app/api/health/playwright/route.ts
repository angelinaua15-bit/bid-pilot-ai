/**
 * GET /api/health/playwright
 *
 * Playwright MUST NOT run on Vercel. This route never launches Chromium.
 * It proxies the check to the Railway worker (GET /health/playwright) if one is
 * configured; otherwise it returns a clean WORKER_REQUIRED structured error.
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { PLAYWRIGHT_USER_MESSAGE, userMessageForCode } from '@/lib/playwright-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!config.worker.enabled) {
    return NextResponse.json(
      { success: false, code: 'WORKER_REQUIRED', message: PLAYWRIGHT_USER_MESSAGE.WORKER_REQUIRED },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`${config.worker.url}/health/playwright`, {
      headers: { Authorization: `Bearer ${config.worker.secret}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));

    if (data?.ok) {
      return NextResponse.json({ success: true, code: 'OK', browser: 'chromium', chromiumVersion: data.chromiumVersion });
    }
    const code = data?.code ?? 'PLAYWRIGHT_NOT_INSTALLED';
    return NextResponse.json({ success: false, code, message: userMessageForCode(code) }, { status: 200 });
  } catch {
    // Worker unreachable — do not leak anything raw.
    return NextResponse.json(
      { success: false, code: 'WORKER_REQUIRED', message: PLAYWRIGHT_USER_MESSAGE.WORKER_REQUIRED },
      { status: 200 },
    );
  }
}