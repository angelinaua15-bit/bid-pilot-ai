/**
 * app/api/freelancehunt/session/route.ts
 *
 * POST /api/freelancehunt/session
 *   body: { token: string, storageState: {cookies, origins}, username?: string }
 *
 * Receives the Freelancehunt session captured in the user's REAL browser (by the
 * extension or local helper), validates the one-time connect token, and stores
 * the storageState in Supabase under the token's userId. The Railway worker then
 * uses this per-user session for Playwright bid submission.
 *
 * CORS: allowed for the browser extension (chrome-extension://...) via wildcard;
 * the connect token is the actual authorization, not the origin.
 */

import { NextResponse } from 'next/server';
import {
  consumeConnectToken,
  saveSession,
  type PlaywrightStorageState,
} from '@/services/freelancehunt-session.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function looksLikeSession(s: unknown): s is PlaywrightStorageState {
  return !!s && typeof s === 'object' && Array.isArray((s as { cookies?: unknown }).cookies);
}

export async function POST(request: Request) {
  let body: { token?: string; storageState?: unknown; username?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'MISSING_TOKEN' }, { status: 400, headers: CORS });
  }
  if (!looksLikeSession(body.storageState)) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_STORAGE_STATE: expected { cookies: [...] }' },
      { status: 400, headers: CORS }
    );
  }
  const cookieCount = body.storageState.cookies.length;
  if (cookieCount === 0) {
    return NextResponse.json(
      { ok: false, error: 'NO_COOKIES: log into Freelancehunt first, then connect' },
      { status: 400, headers: CORS }
    );
  }

  // Validate + consume the one-time token → resolves the userId
  const consumed = await consumeConnectToken(token);
  if (!consumed.ok || !consumed.userId) {
    return NextResponse.json(
      { ok: false, error: `TOKEN_REJECTED: ${consumed.reason}` },
      { status: 401, headers: CORS }
    );
  }

  const saved = await saveSession(consumed.userId, body.storageState, body.username ?? null);
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.reason }, { status: 500, headers: CORS });
  }

  return NextResponse.json(
    { ok: true, userId: consumed.userId, cookieCount },
    { status: 200, headers: CORS }
  );
}