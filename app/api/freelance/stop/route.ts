import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceFilter, getFreelanceFilter } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    console.log('[api/freelance/stop] called with userId:', userId);

    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const existing = await getFreelanceFilter(userId);
    const filter = await upsertFreelanceFilter({
      ...(existing ?? {}),
      userId,
      isEnabled: false,
    });

    console.log('[api/freelance/stop] automation stopped, filter.isEnabled:', filter?.isEnabled);
    return NextResponse.json({ ok: true, isWorkerRunning: false, filter });
  } catch (err) {
    console.error('[api/freelance/stop] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
