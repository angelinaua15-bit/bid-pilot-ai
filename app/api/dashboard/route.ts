/**
 * GET /api/dashboard?userId=...
 * Returns real-time stats for the Dashboard screen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSaaSDashboardStats, getFreelanceAccount } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const [stats, account] = await Promise.all([
      getSaaSDashboardStats(userId),
      getFreelanceAccount(userId),
    ]);

    return NextResponse.json({ ok: true, stats, account });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
