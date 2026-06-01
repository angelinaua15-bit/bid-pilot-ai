import { NextRequest, NextResponse } from 'next/server';
import { validateFreelancehuntToken } from '@/services/freelancehunt.service';
import { upsertFreelanceAccount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId, token } = await req.json() as { userId?: string; token?: string };

    if (!userId?.trim()) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }
    if (!token?.trim()) {
      return NextResponse.json({ ok: false, error: 'Token required' }, { status: 400 });
    }

    const result = await validateFreelancehuntToken(token);
    if (!result.valid) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }

    // Persist the token and connection status in DB
    await upsertFreelanceAccount({
      userId,
      platform:    'freelancehunt',
      accountName: result.username ?? undefined,
      apiToken:    token.trim(),
      status:      'connected',
      lastLoginAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, data: { username: result.username, connected: true } });
  } catch (err) {
    console.error('[POST /api/freelancehunt/connect]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
