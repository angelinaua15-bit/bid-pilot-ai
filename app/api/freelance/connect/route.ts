import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceAccount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId, token } = await req.json();
    if (!userId || !token?.trim()) {
      return NextResponse.json({ ok: false, error: 'userId and token required' }, { status: 400 });
    }

    // Validate the token against Freelancehunt API
    let username: string | undefined;
    try {
      const res = await fetch('https://api.freelancehunt.com/v2/my/profile', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: 'Invalid Freelancehunt token' }, { status: 401 });
      }
      const data = await res.json();
      username = data?.data?.attributes?.login ?? data?.data?.attributes?.first_name;
    } catch {
      return NextResponse.json({ ok: false, error: 'Could not validate token' }, { status: 502 });
    }

    const account = await upsertFreelanceAccount({
      userId,
      platform: 'freelancehunt',
      accountName: username,
      status: 'connected',
      lastCheckAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, account });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
