/**
 * POST /api/send-bid
 * Submits a single bid via the automation worker.
 *
 * Requires AUTOMATION_WORKER_URL — Playwright never runs on Vercel.
 * Body: { projectUrl: string, text: string, budget: number, days: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    if (!config.worker.enabled) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Automation worker not configured. ' +
            'Set AUTOMATION_WORKER_URL and start the worker on your local machine.',
          setupRequired: true,
        },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { projectUrl, text, budget, days } = body;

    if (!projectUrl || !text) {
      return NextResponse.json(
        { ok: false, error: 'projectUrl and text are required' },
        { status: 400 },
      );
    }

    // Delegate to worker POST /send-bid
    const { default: workerFetch } = await import('@/lib/worker-client');
    // Use the generic workerFetch via the named startWorkerAutoBid pattern
    const res = await fetch(`${config.worker.url}/send-bid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.worker.secret}`,
      },
      body: JSON.stringify({ projectUrl, text, budget, days }),
      signal: AbortSignal.timeout(60_000),
    });

    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: json.error ?? `Worker HTTP ${res.status}` }, { status: res.status });
    }

    return NextResponse.json({ ok: true, data: json });
  } catch (err) {
    console.error('[POST /api/send-bid]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
