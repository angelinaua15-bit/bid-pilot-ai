/**
 * GET /api/freelancehunt/status?userId=<id>
 *
 * Returns the Freelancehunt browser-session status for a user.
 * SOURCE OF TRUTH: the Supabase `freelancehunt_sessions` table (written when the
 * user connects via the extension / local helper / worker connect-save).
 *
 * NO Playwright import here — this route runs on Vercel and must stay light.
 * If a worker is configured, its global /status is used only as a fallback.
 *
 * POST ?action=logout&userId=<id> — clears the user's session (Supabase + worker).
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSessionStatus, deleteSession } from '@/services/freelancehunt-session.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? undefined;

  // ── 1. Per-user browser session from Supabase (primary) ───────────────────
  if (userId) {
    try {
      const s = await getSessionStatus(userId);
      if (s.connected) {
        return NextResponse.json({
          ok: true,
          data: {
            connected:   true,
            status:      'connected',
            workerMode:  config.worker.enabled ? config.worker.mode : 'none',
            username:    s.username,
            cookieCount: s.cookieCount,
            updatedAt:   s.updatedAt,
          },
        });
      }
    } catch (err) {
      console.warn('[fh/status] Supabase check failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── 2. Worker global status (fallback) ────────────────────────────────────
  if (config.worker.enabled) {
    try {
      const res = await fetch(`${config.worker.url}/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.worker.secret}` },
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json() as Record<string, unknown>;
      const fh = (data.freelancehunt ?? {}) as Record<string, unknown>;
      return NextResponse.json({
        ok: true,
        data: {
          connected:   Boolean(fh.connected),
          status:      fh.connected ? 'connected' : 'reconnect',
          workerMode:  config.worker.mode,
          username:    fh.username,
          cookieCount: fh.cookieCount,
          error:       fh.connected ? undefined : ((fh.error as string) ?? 'Not connected'),
        },
      });
    } catch (err) {
      console.warn('[fh/status] Worker unreachable:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── 3. Nothing connected ──────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    data: {
      connected:  false,
      status:     'reconnect',
      workerMode: config.worker.enabled ? config.worker.mode : 'none',
      error:      'Потрібно перепідключити Freelancehunt. Натисніть «Підключити» і увійдіть через браузер.',
    },
  });
}

/**
 * POST /api/freelancehunt/status?action=logout&userId=<id>
 * Clears the user's session from Supabase (and the worker, if configured).
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? undefined;

  if (userId) {
    await deleteSession(userId).catch(() => {});
    try {
      const { upsertFreelanceAccount } = await import('@/lib/db');
      await upsertFreelanceAccount({ userId, status: 'disconnected' });
    } catch { /* non-fatal */ }
  }

  if (config.worker.enabled) {
    try {
      await fetch(`${config.worker.url}/connect/freelancehunt/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.worker.secret}`,
        },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, message: 'Session cleared' });
}