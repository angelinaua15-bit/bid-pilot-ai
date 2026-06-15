/**
 * GET /api/freelancehunt/status[?userId=<id>]
 *
 * Returns the current Freelancehunt session status.
 *
 * Priority:
 *   1. Worker mode  → delegates to worker's GET /status
 *   2. Per-user session file (sessions/freelancehunt_<userId>.json)
 *   3. Global storageState.json exists
 *   4. DB account status (set after browser login completes)
 *   5. FREELANCEHUNT_TOKEN env var validation
 *   6. Nothing configured → connected: false
 *
 * POST ?action=logout — proxies to worker logout or clears local session file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? undefined;

  // ── 1. Worker mode ────────────────────────────────────────────────────────
  if (config.worker.enabled) {
    try {
      const res = await fetch(`${config.worker.url}/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.worker.secret}` },
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        return NextResponse.json({
          ok: true,
          data: {
            connected: false,
            workerMode: config.worker.mode,
            error: (data.error as string) ?? `Worker returned ${res.status}`,
          },
        });
      }

      const fh = (data.freelancehunt ?? {}) as Record<string, unknown>;

      return NextResponse.json({
        ok: true,
        data: {
          connected:    Boolean(fh.connected),
          workerMode:   config.worker.mode,
          username:     fh.username,
          cookieCount:  fh.cookieCount,
          sessionPath:  fh.sessionPath,
          error:        fh.connected ? undefined : ((fh.error as string) ?? 'Not connected'),
          autoLoop:     data.autoLoop ?? null,
          counters:     data.counters ?? null,
        },
      });
    } catch (err) {
      // Worker unreachable — fall through to local checks
      console.warn('[fh/status] Worker unreachable:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── 2. Per-user session file ──────────────────────────────────────────────
  if (userId) {
    try {
      const { sessionExists, resolveSessionPath } = await import('@/services/playwright-browser.service');
      const exists = sessionExists(userId);
      const sessionPath = resolveSessionPath(userId);

      if (exists) {
        return NextResponse.json({
          ok: true,
          data: { connected: true, workerMode: 'none', sessionPath },
        });
      }
    } catch {
      // playwright not available in this runtime — continue
    }
  }

  // ── 3. Global storageState.json ───────────────────────────────────────────
  try {
    const { sessionExists, resolveSessionPath } = await import('@/services/playwright-browser.service');
    const exists = sessionExists();
    const sessionPath = resolveSessionPath();

    if (exists) {
      return NextResponse.json({
        ok: true,
        data: { connected: true, workerMode: 'none', sessionPath },
      });
    }
  } catch {
    // playwright not available in this runtime — continue
  }

  // ── 4. DB account status ──────────────────────────────────────────────────
  if (userId) {
    try {
      const { getFreelanceAccount } = await import('@/lib/db');
      const account = await getFreelanceAccount(userId);
      if (account?.status === 'connected') {
        return NextResponse.json({
          ok: true,
          data: {
            connected:   true,
            workerMode:  config.worker.enabled ? config.worker.mode : 'none',
            username:    account.accountName,
            lastLoginAt: account.lastLoginAt,
          },
        });
      }
      if (account?.status === 'expired') {
        return NextResponse.json({
          ok: true,
          data: {
            connected:  false,
            workerMode: 'none',
            error:      'Сесія протухла. Перепідключіть акаунт Freelancehunt.',
            expired:    true,
          },
        });
      }
    } catch { /* non-fatal */ }
  }

  // ── 5. FREELANCEHUNT_TOKEN env var — legacy fallback (API deprecated, skipped) ──
  // POST /v2/projects/{id}/bids returns HTTP 410; only used for display name lookup.
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (token) {
    try {
      // Attempt a simple profile check — validateFreelancehuntToken may not exist
      // in older builds; skip gracefully if not found
      const fhService = await import('@/services/freelancehunt.service') as Record<string, unknown>;
      const validateFn = fhService['validateFreelancehuntToken'];
      if (typeof validateFn === 'function') {
        const result = await (validateFn as (t: string) => Promise<{ valid: boolean; username?: string }>)(token);
        return NextResponse.json({
          ok: true,
          data: {
            connected:  result.valid,
            workerMode: 'none',
            username:   result.username,
            error:      result.valid ? undefined : 'Token invalid or expired',
          },
        });
      }
    } catch { /* continue */ }
  }

  // ── 6. Nothing configured ─────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    data: {
      connected:  false,
      workerMode: 'none',
      error:      'Сесія Freelancehunt не знайдена. Натисніть "Підключити" і увійдіть через браузер.',
    },
  });
}

/**
 * POST /api/freelancehunt/status?action=logout[&userId=<id>]
 * Proxies to worker logout or clears local session file.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') ?? undefined;

  if (config.worker.enabled) {
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

  // Local mode: delete per-user or global session file + update DB
  try {
    const { resolveSessionPath } = await import('@/services/playwright-browser.service');
    const fs = await import('fs');
    const sessionPath = resolveSessionPath(userId);
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);

    if (userId) {
      try {
        const { upsertFreelanceAccount } = await import('@/lib/db');
        await upsertFreelanceAccount({ userId, status: 'disconnected' });
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ ok: true, message: 'Session cleared' });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to clear session' },
      { status: 500 }
    );
  }
}
