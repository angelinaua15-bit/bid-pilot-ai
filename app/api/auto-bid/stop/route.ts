/**
 * POST /api/auto-bid/stop
 * Emergency stop — delegates to worker when AUTOMATION_WORKER_URL is set,
 * otherwise sets emergencyStop flag in local DB settings.
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function POST() {
  try {
    if (config.worker.enabled) {
      const { stopWorkerAutoBid } = await import('@/lib/worker-client');
      const result = await stopWorkerAutoBid();
      return NextResponse.json({ ok: result.ok, workerMode: true });
    }

    // Local mode: set emergencyStop in DB settings
    const { saveSettings, getSettings } = await import('@/lib/db');
    const current = await getSettings();
    await saveSettings({ ...current, enabled: false, emergencyStop: true });
    return NextResponse.json({ ok: true, workerMode: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
