import { NextRequest, NextResponse } from 'next/server';
import { upsertFreelanceAccount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userId, token } = await req.json();
    if (!userId || !token?.trim()) {
      return NextResponse.json({ ok: false, error: 'userId and token required' }, { status: 400 });
    }

    const cleanToken = token.trim();

    // Validate the token against Freelancehunt API
    let username: string | undefined;
    let profileId: number | undefined;
    try {
      const res = await fetch('https://api.freelancehunt.com/v2/my/profile', {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json(
          { ok: false, error: err?.errors?.[0]?.detail ?? 'Invalid Freelancehunt token' },
          { status: 401 },
        );
      }
      const data = await res.json();
      username  = data?.data?.attributes?.login ?? data?.data?.attributes?.first_name;
      profileId = data?.data?.id;
    } catch {
      return NextResponse.json({ ok: false, error: 'Could not reach Freelancehunt API' }, { status: 502 });
    }

    // Save token alongside account so other routes can use it
    const account = await upsertFreelanceAccount({
      userId,
      platform: 'freelancehunt',
      accountName: username ?? `user_${profileId}`,
      apiToken: cleanToken,
      status: 'connected',
      lastCheckAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, account, username });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
