/**
 * POST /api/auto-bid/run
 * Triggers one full auto-bid cycle.
 *
 * IMPORTANT: Playwright never runs on Vercel.
 * This route requires AUTOMATION_WORKER_URL to be set.
 * Without it, it returns a 503 with setup instructions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { appendLog, getSettings } from '@/lib/db';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    // ── Worker required — Playwright cannot run on Vercel ─────────────────────
    if (!config.worker.enabled) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Automation worker not configured. ' +
            'Set AUTOMATION_WORKER_URL and AUTOMATION_SECRET, then start the worker on your local machine with: npm run worker:start',
          workerMode: false,
          setupRequired: true,
        },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { startWorkerAutoBid } = await import('@/lib/worker-client');

    const dbSettings = await getSettings();
    const settings = body.settings ? { ...dbSettings, ...body.settings } : dbSettings;

    const result = await startWorkerAutoBid({ settings });

    // Persist logs returned by the worker into the Supabase DB
    if (Array.isArray(result.logs)) {
      for (const logEntry of result.logs) {
        await appendLog(logEntry).catch(() => { /* non-fatal */ });
      }
    }

    return NextResponse.json({ ok: result.ok, data: result, workerMode: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/auto-bid/run]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Use POST to trigger an auto-bid run.',
    workerMode: config.worker.enabled,
    workerUrl: config.worker.enabled ? config.worker.url : null,
    setupRequired: !config.worker.enabled,
  });
}
