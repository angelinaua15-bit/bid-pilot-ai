/**
 * app/api/freelancehunt/connect-token/route.ts
 *
 * POST /api/freelancehunt/connect-token   body: { userId }
 * Mints a one-time, short-lived code that the browser extension (or local
 * helper) uses to upload the captured session for THIS user.
 *
 * Security: derive userId from your authenticated Mini App session, not from
 * untrusted client input. The line below reads it from the body for clarity —
 * replace `bodyUserId` with your server-side session userId once wired to your
 * auth (Telegram initData / Supabase auth).
 */

import { NextResponse } from 'next/server';
import { mintConnectToken } from '@/services/freelancehunt-session.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { userId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'MISSING_USER_ID' }, { status: 400 });
  }

  const result = await mintConnectToken(userId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, token: result.token, expiresAt: result.expiresAt },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}