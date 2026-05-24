// User-facing: submit a payment proof
import { NextRequest, NextResponse } from 'next/server';
import { createManualPayment, getUserById } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId, paymentSettingId, methodName, amount, currency, transactionId, proofNote, plan } = await req.json();
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    if (!plan) return NextResponse.json({ ok: false, error: 'plan required' }, { status: 400 });

    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });

    const payment = await createManualPayment({
      userId,
      userName: user.name,
      userUsername: user.username,
      paymentSettingId,
      methodName,
      amount,
      currency,
      transactionId,
      proofNote,
      plan,
    });
    return NextResponse.json({ ok: true, payment });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') ?? '';
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    const { getManualPayments } = await import('@/lib/db');
    const payments = await getManualPayments({ userId });
    return NextResponse.json({ ok: true, payments });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
