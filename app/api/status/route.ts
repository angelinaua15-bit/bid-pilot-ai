/**
 * app/api/freelancehunt/status/route.ts
 *
 * GET /api/freelancehunt/status?userId=<id>
 * Returns the connection status of a specific user's Freelancehunt session,
 * read from Supabase (the source of truth). Used by the Profile/Freelancehunt
 * screen to show Connected vs Reconnect.
 */

import { NextResponse } from 'next/server';
import { getSessionStatus } from '@/services/freelancehunt-session.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId')?.trim();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'MISSING_USER_ID: query param "userId" is required' },
      { status: 400 }
    );
  }

  try {
    const status = await getSessionStatus(userId);
    return NextResponse.json(
      {
        ok: true,
        userId: status.userId,
        connected: status.connected,
        status: status.status, // 'connected' | 'reconnect'
        username: status.username ?? null,
        cookieCount: status.cookieCount,
        updatedAt: status.updatedAt ?? null,
        reason: status.reason ?? null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, connected: false, status: 'reconnect', error: message },
      { status: 200 } // soft-fail: UI shows Reconnect rather than crashing
    );
  }
}