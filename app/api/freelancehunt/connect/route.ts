/**
 * app/api/freelancehunt/connect/route.ts
 *
 * Vercel-safe connect controller. The interactive Playwright login runs on the
 * WORKER (Railway), never on Vercel — so this route only PROXIES to the worker.
 *
 * It imports nothing heavy: no 'playwright', no 'node:http', no worker code.
 * That is what keeps `next build` / Vercel deploy green.
 *
 * Worker endpoints proxied (see worker/server.ts):
 *   POST   /connect              → start login, returns { sessionId }
 *   GET    /connect/status?sessionId=...   → { status, username, error }
 *   POST   /connect/save         body { sessionId, userId } → persists session
 *   POST   /connect/logout       body { userId }            → clears session
 *
 * Client usage:
 *   POST /api/freelancehunt/connect            { action: 'start' }
 *   GET  /api/freelancehunt/connect?sessionId=...
 *   POST /api/freelancehunt/connect            { action: 'save', sessionId, userId }
 *   POST /api/freelancehunt/connect            { action: 'logout', userId }
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_URL =
  process.env.WORKER_URL ??
  process.env.NEXT_PUBLIC_WORKER_URL ??
  process.env.RAILWAY_WORKER_URL;

const AUTH = process.env.AUTOMATION_SECRET ?? '';

function workerHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH}`,
  };
}

function noWorker() {
  return NextResponse.json(
    { ok: false, error: 'WORKER_URL is not configured' },
    { status: 503 }
  );
}

/** Forward a request to the worker and pass its JSON response straight through. */
async function forward(path: string, init: RequestInit) {
  const res = await fetch(`${WORKER_URL}${path}`, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { ok: false, error: `Non-JSON worker response: ${text.slice(0, 200)}` };
  }
  return NextResponse.json(body, { status: res.status });
}

// ─── GET: connect status ──────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!WORKER_URL) return noWorker();

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId')?.trim();
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'MISSING_SESSION_ID: query param "sessionId" is required' },
      { status: 400 }
    );
  }

  try {
    return await forward(`/connect/status?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: workerHeaders(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

// ─── POST: start / save / logout ────────────────────────────────────────────-

export async function POST(request: Request) {
  if (!WORKER_URL) return noWorker();

  let payload: { action?: string; sessionId?: string; userId?: string } = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const action = payload.action ?? 'start';

  try {
    switch (action) {
      case 'start':
        return await forward('/connect', {
          method: 'POST',
          headers: workerHeaders(),
          body: JSON.stringify({ userId: payload.userId }),
        });

      case 'save':
        if (!payload.sessionId || !payload.userId) {
          return NextResponse.json(
            { ok: false, error: 'SAVE requires { sessionId, userId }' },
            { status: 400 }
          );
        }
        return await forward('/connect/save', {
          method: 'POST',
          headers: workerHeaders(),
          body: JSON.stringify({ sessionId: payload.sessionId, userId: payload.userId }),
        });

      case 'logout':
        return await forward('/connect/logout', {
          method: 'POST',
          headers: workerHeaders(),
          body: JSON.stringify({ userId: payload.userId }),
        });

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action "${action}"` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}