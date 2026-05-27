/**
 * POST /api/send-bid
<<<<<<< HEAD
 * Submits a bid directly via Freelancehunt REST API using the stored token.
 * No worker/Playwright required.
 * Body: { userId, projectId, text, budget, days }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, incrementBidCount } from '@/lib/db';

const FH_BASE = 'https://api.freelancehunt.com/v2';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, projectId, text, budget, days } = body;

    if (!userId || !projectId || !text) {
      return NextResponse.json(
        { ok: false, error: 'userId, projectId and text are required' },
=======
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
>>>>>>> dd99fc0 (resolve merge conflicts)
        { status: 400 },
      );
    }

<<<<<<< HEAD
    // Get the stored token
    const account = await getFreelanceAccount(userId);
    if (!account?.apiToken) {
=======
    // Delegate to worker POST /send-bid

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
>>>>>>> dd99fc0 (resolve merge conflicts)
      return NextResponse.json(
        {
          ok: false,
          error: json.error ?? `Worker HTTP ${res.status}`,
        },
        { status: res.status },
      );
    }

    return NextResponse.json({
      ok: true,
      data: json,
    });
<<<<<<< HEAD

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = json?.errors?.[0]?.detail ?? `Freelancehunt API error ${res.status}`;
      return NextResponse.json({ ok: false, error: errMsg }, { status: res.status });
    }

    // Track bid count in DB
    await incrementBidCount(userId).catch(() => {/* non-fatal */});

    return NextResponse.json({ ok: true, data: json?.data });
=======
>>>>>>> dd99fc0 (resolve merge conflicts)
  } catch (err) {
    console.error('[POST /api/send-bid]', err);

    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Server error',
      },
      { status: 500 },
    );
  }
}