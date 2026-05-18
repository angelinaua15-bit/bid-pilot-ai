/**
 * app/api/connect/freelancehunt/route.ts
 *
 * Proxies Freelancehunt connect requests from the Telegram Mini App
 * to the local automation worker. The worker runs Playwright on the Mac
 * so the user can log in manually in a real browser window.
 *
 * Endpoints:
 *   POST /api/connect/freelancehunt          — start a new login session
 *   GET  /api/connect/freelancehunt?session= — poll session status
 *   POST /api/connect/freelancehunt/save     — save session after login
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

function workerHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.worker.secret}`,
  };
}

function noWorker() {
  return NextResponse.json(
    {
      ok: false,
      error:
        'Automation worker not configured. Set AUTOMATION_WORKER_URL and start the worker with: npm run worker',
    },
    { status: 503 }
  );
}

/** POST /api/connect/freelancehunt — start a Playwright login session */
export async function POST(req: NextRequest) {
  if (!config.worker.enabled) return noWorker();

  // Distinguish between "start" and "save" via ?action= query param
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'save') {
    const { sessionId } = await req.json().catch(() => ({}));
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 });
    }

    try {
      const res = await fetch(
        `${config.worker.url}/connect/freelancehunt/save/${encodeURIComponent(sessionId)}`,
        { method: 'POST', headers: workerHeaders(), signal: AbortSignal.timeout(15_000) }
      );
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'Worker unreachable' },
        { status: 502 }
      );
    }
  }

  // Default: start a new login session
  try {
    const res = await fetch(`${config.worker.url}/connect/freelancehunt/start`, {
      method: 'POST',
      headers: workerHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Worker unreachable' },
      { status: 502 }
    );
  }
}

/** GET /api/connect/freelancehunt?session=<id> — poll session status */
export async function GET(req: NextRequest) {
  if (!config.worker.enabled) return noWorker();

  const sessionId = new URL(req.url).searchParams.get('session');
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session query param is required' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${config.worker.url}/connect/freelancehunt/status/${encodeURIComponent(sessionId)}`,
      { method: 'GET', headers: workerHeaders(), signal: AbortSignal.timeout(8_000) }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Worker unreachable' },
      { status: 502 }
    );
  }
}
