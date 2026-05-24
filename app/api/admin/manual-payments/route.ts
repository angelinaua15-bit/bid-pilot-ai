import { NextRequest, NextResponse } from 'next/server';
import { getManualPayments, reviewManualPayment, getUserById } from '@/lib/db';

async function assertAdmin(requesterId: string) {
  const user = await getUserById(requesterId);
  return user?.role === 'owner' || user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requesterId = searchParams.get('requesterId') ?? '';
    const admin = await assertAdmin(requesterId);
    if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    const status = searchParams.get('status') ?? undefined;
    const payments = await getManualPayments({ status });
    return NextResponse.json({ ok: true, payments });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { requesterId, paymentId, action } = await req.json();
    const admin = await assertAdmin(requesterId);
    if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }
    const payment = await reviewManualPayment(paymentId, action === 'approve' ? 'approved' : 'rejected', requesterId);
    return NextResponse.json({ ok: true, payment });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
