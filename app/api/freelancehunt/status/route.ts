/**
 * GET /api/freelancehunt/status
 *
 * Returns the current Freelancehunt session status.
 *
 * Priority:
 *   1. Worker mode (AUTOMATION_WORKER_URL or LOCAL_WORKER_URL set)
 *      → delegates to worker's GET /status endpoint
 *   2. Local storageState.json exists
 *      → checks file presence only (fast) — returns connected: true
 *   3. FREELANCEHUNT_TOKEN in env
 *      → validates token via API
 *   4. None configured → connected: false
 *
 * POST ?action=logout — proxies to worker logout or deletes storageState locally.
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET() {
  // ── 1. Worker mode ────────────────────────────────────────────────────────
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
<<<<<<< HEAD
            workerMode: config.worker.mode,
=======
            workerMode: config.worker.enabled ? 'worker' : 'none',
>>>>>>> dd99fc0 (resolve merge conflicts)
            error: data.error ?? `Worker returned ${res.status}`,
          },
        });
      }

      const fh = data.freelancehunt ?? {};

      return NextResponse.json({
        ok: true,
        data: {
<<<<<<< HEAD
          connected:    Boolean(fh.connected),
          workerMode:   config.worker.mode,
          username:     fh.username,
          cookieCount:  fh.cookieCount,
          sessionPath:  fh.sessionPath,
          error:        fh.connected ? undefined : (fh.error ?? 'Not connected'),
          autoLoop:     data.autoLoop ?? null,
          counters:     data.counters ?? null,
=======
          connected: Boolean(fh.connected),
          workerMode: config.worker.enabled ? 'worker' : 'none',
          username: fh.username,
          cookieCount: fh.cookieCount,
          sessionPath: fh.sessionPath,
          error: fh.connected ? undefined : (fh.error ?? 'Not connected'),
          autoLoop: data.autoLoop ?? null,
          counters: data.counters ?? null,
>>>>>>> dd99fc0 (resolve merge conflicts)
        },
      });
    } catch (err) {
      return NextResponse.json({
        ok: true,
        data: {
          connected: false,
<<<<<<< HEAD
          workerMode: config.worker.mode,
=======
          workerMode: config.worker.enabled ? 'worker' : 'none',
>>>>>>> dd99fc0 (resolve merge conflicts)
          error: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }

  // ── 2. Local mode: check storageState.json ────────────────────────────────
  try {
    const { sessionExists, resolveSessionPath } = await import('@/services/playwright-browser.service');
    const exists = sessionExists();
    const sessionPath = resolveSessionPath();

    if (exists) {
      return NextResponse.json({
        ok: true,
        data: {
          connected: true,
          workerMode: 'none',
          sessionPath,
          // Username and deep session verify happen in the worker.
          // Here we confirm the file exists which is sufficient for UI Connected state.
        },
      });
    }
  } catch {
    // playwright not available in this runtime — continue to token check
  }

  // ── 3. Fallback: FREELANCEHUNT_TOKEN ─────────────────────────────────────
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (token) {
    try {
      const { validateFreelancehuntToken } = await import('@/services/freelancehunt.service');
      const result = await validateFreelancehuntToken(token);
      return NextResponse.json({
        ok: true,
        data: {
          connected: result.valid,
          workerMode: 'none',
          username: result.username,
          error: result.valid ? undefined : 'Token invalid or expired',
        },
      });
    } catch (err) {
      return NextResponse.json({
        ok: true,
        data: {
          connected: false,
          workerMode: 'none',
          error: err instanceof Error ? err.message : 'Token validation failed',
        },
      });
    }
  }

  // ── 4. Nothing configured ────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    data: {
      connected: false,
      workerMode: 'none',
      error: 'No session found. Run: npm run login:freelancehunt to save your Freelancehunt session.',
    },
  });
}

/**
 * POST /api/freelancehunt/status?action=logout
 * Proxies to worker's logout endpoint or clears local session file.
 */
export async function POST() {
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

  // Local mode: delete storageState.json
  try {
    const { resolveSessionPath } = await import('@/services/playwright-browser.service');
    const fs = await import('fs');
    const p = resolveSessionPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);

    return NextResponse.json({
      ok: true,
      message: 'Session cleared',
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to clear session',
      },
      { status: 500 }
    );
  }
}