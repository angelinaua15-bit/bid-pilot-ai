import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceFilter, getFreelanceFilter, stopAutomationJob } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const [existing] = await Promise.all([
      getFreelanceFilter(userId),
      stopAutomationJob(userId),
    ]);

    const filter = await upsertFreelanceFilter({
      ...(existing ?? {}),
      userId,
      isEnabled: false,
    });

    return NextResponse.json({ ok: true, isWorkerRunning: false, filter });
  } catch (err) {
    console.error('[api/freelance/stop] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
