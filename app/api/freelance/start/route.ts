import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceFilter, getFreelanceFilter, upsertFreelanceAccount, getFreelanceAccount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    console.log('[api/freelance/start] called with userId:', userId);

    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const account = await getFreelanceAccount(userId);
    if (!account) {
      console.log('[api/freelance/start] no account found for userId:', userId);
      return NextResponse.json({ ok: false, error: 'Freelance account not connected' }, { status: 400 });
    }

    // Enable the automation filter (isEnabled = true is our "worker running" flag)
    const existing = await getFreelanceFilter(userId);
    const filter = await upsertFreelanceFilter({
      ...(existing ?? {}),
      userId,
      isEnabled: true,
    });

    // Mark account as active
    await upsertFreelanceAccount({ userId, status: 'connected' });

    console.log('[api/freelance/start] automation started, filter.isEnabled:', filter?.isEnabled);
    return NextResponse.json({ ok: true, isWorkerRunning: true, filter });
  } catch (err) {
    console.error('[api/freelance/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
