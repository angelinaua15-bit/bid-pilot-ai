/**
 * GET  /api/auto-bid/settings  — return current settings (from DB or memory)
 * POST /api/auto-bid/settings  — patch settings (partial merge, persisted)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSettings, patchSettings } from '@/lib/db';

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ ok: true, data: settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
    }

    if (body.emergencyStop) {
      console.warn('[AutoBid] EMERGENCY STOP activated via settings API');
    }

    const updated = await patchSettings(body);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
