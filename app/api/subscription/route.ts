import { NextRequest, NextResponse } from 'next/server';
import { getUserById } from '@/lib/db';
import { PLAN_LIMITS } from '@/types';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
  }

  const limits = PLAN_LIMITS[user.subscriptionPlan];

  return NextResponse.json({
    ok: true,
    data: {
      plan:             user.subscriptionPlan,
      status:           user.subscriptionStatus,
      expiresAt:        user.subscriptionExpiresAt,
      applicationsUsed: user.applicationsThisMonth,
      applicationsLimit: limits.applicationsPerMonth,
      features:         limits,
    },
  });
}
