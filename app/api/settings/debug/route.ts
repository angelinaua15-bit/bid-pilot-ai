import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

/**
 * GET /api/settings/debug
 *
 * Proxies GET /settings/debug from the automation worker.
 * Returns the exact settings object the worker loaded, along with the source
 * (supabase vs. in-memory default) and enabled/disabled state.
 *
 * If the worker is not configured, returns the local DB settings directly.
 */
export async function GET() {
  // ── Worker mode: proxy to the worker ──────────────────────────────────────
  if (config.worker.enabled && config.worker.url) {
    try {
      const res = await fetch(`${config.worker.url}/settings/debug`, {
        headers: { Authorization: `Bearer ${config.worker.secret}` },
        cache: 'no-store',
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `Worker unreachable: ${message}` },
        { status: 503 }
      );
    }
  }

  // ── Local mode: read from DB / memory ─────────────────────────────────────
  try {
    const { getSettings } = await import('@/lib/db');
    const settings = await getSettings();
    const isSupabaseConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    return NextResponse.json({
      ok: true,
      settings,
      meta: {
        source: isSupabaseConfigured ? 'supabase' : 'memory/default',
        supabaseConfigured: isSupabaseConfigured,
        workerEnabled: false,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
