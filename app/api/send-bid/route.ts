/**
 * POST /api/send-bid
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
        { status: 400 },
      );
    }

    // Get the stored token
    const account = await getFreelanceAccount(userId);
    if (!account?.apiToken) {
      return NextResponse.json(
        { ok: false, error: 'No Freelancehunt token found for this user' },
        { status: 401 },
      );
    }

    const payload: Record<string, unknown> = {
      data: {
        type: 'bid',
        attributes: {
          comment: text,
          ...(budget != null ? { budget } : {}),
          ...(days   != null ? { days   } : {}),
        },
      },
    };

    const res = await fetch(`${FH_BASE}/projects/${projectId}/bids`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${account.apiToken}`,
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = json?.errors?.[0]?.detail ?? `Freelancehunt API error ${res.status}`;
      return NextResponse.json({ ok: false, error: errMsg }, { status: res.status });
    }

    // Track bid count in DB
    await incrementBidCount(userId).catch(() => {/* non-fatal */});

    return NextResponse.json({ ok: true, data: json?.data });
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
