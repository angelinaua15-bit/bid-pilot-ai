import { NextRequest, NextResponse } from 'next/server';
import { getPaymentSettings, upsertPaymentSetting, deletePaymentSetting } from '@/lib/db';
import { assertAdmin } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requesterId = searchParams.get('requesterId') ?? '';
    const admin = await assertAdmin(requesterId);
    if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    const settings = await getPaymentSettings();
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { requesterId, ...body } = await req.json();
    const admin = await assertAdmin(requesterId);
    if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    const setting = await upsertPaymentSetting({ ...body, createdBy: requesterId });
    return NextResponse.json({ ok: true, setting });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { requesterId, id } = await req.json();
    const admin = await assertAdmin(requesterId);
    if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    await deletePaymentSetting(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
