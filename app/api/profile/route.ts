import { NextRequest, NextResponse } from 'next/server';
import { getUserById, getFreelanceAccount, upsertFreelanceFilter, getFreelanceFilter } from '@/lib/db';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
  }

  try {
    const [user, account, filter] = await Promise.all([
      getUserById(userId),
      getFreelanceAccount(userId),
      getFreelanceFilter(userId),
    ]);

    if (!user) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: { user, account, filter } });
  } catch (err) {
    console.error('[GET /api/profile]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      userId?: string;
      filter?: Record<string, unknown>;
    };

    const { userId, filter } = body;

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }

    const updated = filter
      ? await upsertFreelanceFilter({ ...(filter as Parameters<typeof upsertFreelanceFilter>[0]), userId })
      : null;

    return NextResponse.json({ ok: true, data: { filter: updated } });
  } catch (err) {
    console.error('[PUT /api/profile]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
