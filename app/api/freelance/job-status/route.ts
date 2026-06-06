/**
 * GET /api/freelance/job-status?userId=...
 * Returns the current automation job status and stats for a user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getActiveAutomationJob, getFreelanceFilter } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const [job, filter] = await Promise.all([
      getActiveAutomationJob(userId),
      getFreelanceFilter(userId),
    ]);

    return NextResponse.json({
      ok:              true,
      isWorkerRunning: job !== null,
      job:             job ?? null,
      isEnabled:       filter?.isEnabled ?? false,
    });
  } catch (err) {
    console.error('[api/freelance/job-status] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
