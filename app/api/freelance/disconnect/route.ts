import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceAccount, getFreelanceAccount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const existing = await getFreelanceAccount(userId);
    if (!existing) return NextResponse.json({ ok: true });

    await upsertFreelanceAccount({
      ...existing,
      userId,
      status: 'disconnected',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
