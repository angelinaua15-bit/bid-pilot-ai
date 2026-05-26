/**
 * GET /api/freelancehunt/status
 *
 * Returns the current Freelancehunt session status.
 * When worker mode is active, delegates to the worker's /status endpoint.
 * Falls back to local token check otherwise.
 *
 * DELETE /api/freelancehunt/status (proxied as POST ?action=logout)
 * Handled by /api/connect/freelancehunt?action=logout
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET() {
  // ── Worker mode: get live session status from the worker ──────────────────
  if (config.worker.enabled) {
    try {
      const res = await fetch(`${config.worker.url}/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.worker.secret}` },
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json({
          ok: true,
          data: {
            connected: false,
            error: data.error ?? `Worker returned ${res.status}`,
          },
        });
      }

      const fh = data.freelancehunt ?? {};

      return NextResponse.json({
        ok: true,
        data: {
          connected:    Boolean(fh.connected),
          username:     fh.username,
          cookieCount:  fh.cookieCount,
          sessionPath:  fh.sessionPath,
          error:        fh.connected ? undefined : (fh.error ?? 'Not connected'),
          autoLoop:     data.autoLoop ?? null,
        },
      });
    } catch (err) {
      return NextResponse.json({
        ok: true,
        data: {
          connected: false,
          error: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }

  // ── Local mode: check FREELANCEHUNT_TOKEN ─────────────────────────────────
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (!token) {
    return NextResponse.json({
      ok: true,
      data: { connected: false, error: 'FREELANCEHUNT_TOKEN not set' },
    });
  }

  try {
    const { validateFreelancehuntToken } = await import('@/services/freelancehunt.service');
    const result = await validateFreelancehuntToken(token);
    return NextResponse.json({
      ok: true,
      data: {
        connected: result.valid,
        username:  result.username,
        error:     result.valid ? undefined : 'Token invalid or expired',
      },
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      data: {
        connected: false,
        error: err instanceof Error ? err.message : 'Token validation failed',
      },
    });
  }
}

/**
 * POST /api/freelancehunt/status?action=logout
 * Proxies to worker's logout endpoint.
 */
export async function POST() {
  if (!config.worker.enabled) {
    return NextResponse.json({ ok: false, error: 'Worker not configured' }, { status: 503 });
  }
  try {
    const res = await fetch(`${config.worker.url}/connect/freelancehunt/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.worker.secret}` },
      signal: AbortSignal.timeout(8_000),
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
