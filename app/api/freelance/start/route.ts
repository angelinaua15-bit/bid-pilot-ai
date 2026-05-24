import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceFilter, getFreelanceFilter } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const existing = await getFreelanceFilter(userId);
    const filter = await upsertFreelanceFilter({
      userId,
      ...(existing ?? {}),
      isEnabled: true,
    });

    return NextResponse.json({ ok: true, filter });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
