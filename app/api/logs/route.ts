/**
 * GET    /api/logs?limit=50&level=error  — fetch logs
 * DELETE /api/logs                        — clear all logs
 *
 * When AUTOMATION_WORKER_URL is set, GET merges worker logs with local DB logs.
 * DELETE only clears local DB logs (worker manages its own log retention).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLogs, clearLogs } from '@/lib/db';
import { config } from '@/lib/config';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit     = Math.min(Number(searchParams.get('limit') ?? '100'), 500);
    const level     = searchParams.get('level') ?? undefined;
    const projectId = searchParams.get('projectId') ?? undefined;

    // ── Worker mode: fetch logs from worker ───────────────────────────────────
    if (config.worker.enabled) {
      try {
        const { getWorkerLogs } = await import('@/lib/worker-client');
        const workerResult = await getWorkerLogs({ limit, level });
        // Normalise: worker may return .data or .logs — always expose as .data
        const data = Array.isArray(workerResult.data)
          ? workerResult.data
          : Array.isArray((workerResult as Record<string, unknown>).logs)
            ? (workerResult as Record<string, unknown>).logs as unknown[]
            : [];
        if (workerResult.ok) {
          return NextResponse.json({
            ok: true,
            data,
            total: workerResult.total ?? data.length,
            source: 'worker',
          });
        }
        // Worker returned ok:false — return empty list with the error for UI display
        return NextResponse.json({
          ok: true,
          data: [],
          total: 0,
          source: 'worker',
          workerError: workerResult.error,
        });
      } catch (err) {
        // Worker unreachable — return empty list so the page renders, not crashes
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[logs] Worker unreachable, returning empty list:', message);
        return NextResponse.json({
          ok: true,
          data: [],
          total: 0,
          source: 'worker-unreachable',
          workerError: message,
        });
      }
    }

    // ── Local / fallback: read from Supabase DB ───────────────────────────────
    const { logs, total } = await getLogs({ limit, level, projectId });
    return NextResponse.json({
      ok: true,
      data: Array.isArray(logs) ? logs : [],
      total: total ?? 0,
      source: 'db',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[logs] GET error:', message);
    // Always return a valid JSON response — never let the page crash
    return NextResponse.json({ ok: true, data: [], total: 0, error: message }, { status: 200 });
  }
}

export async function DELETE() {
  try {
    await clearLogs();
    return NextResponse.json({ ok: true, message: 'Local logs cleared' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
