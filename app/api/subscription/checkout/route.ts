import { NextRequest, NextResponse } from 'next/server';
import { getUserById, getPaymentSettings, updateUserPlan } from '@/lib/db';
import type { SubscriptionPlanSaaS } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { userId, planId } = await req.json() as {
      userId?: string;
      planId?: SubscriptionPlanSaaS;
    };

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }
    if (!planId) {
      return NextResponse.json({ ok: false, error: 'planId required' }, { status: 400 });
    }

    // Free plan — activate immediately
    if (planId === 'free') {
      await updateUserPlan(userId, 'free');
      return NextResponse.json({ ok: true, data: { activated: true } });
    }

    // Paid plans — return active payment methods for manual payment
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    const paymentMethods = await getPaymentSettings(true /* onlyActive */);
    if (paymentMethods.length === 0) {
      return NextResponse.json({ ok: false, error: 'No active payment methods configured' }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        manual: true,
        paymentMethods,
        instructions: 'Оплатіть за одним з реквізитів та надішліть скрін адміну для підтвердження.',
      },
    });
  } catch (err) {
    console.error('[POST /api/subscription/checkout]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
