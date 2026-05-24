/**
 * POST /api/auth/me
 * Resolves or creates a SaaS user from Telegram identity data.
 * Called on every app load — idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateUser } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { telegramId, name, username } = await req.json();
    if (!telegramId || typeof telegramId !== 'number') {
      return NextResponse.json({ ok: false, error: 'telegramId required' }, { status: 400 });
    }
    const user = await getOrCreateUser(Number(telegramId), String(name ?? 'User'), username);
    if (!user) {
      // Supabase not configured — return a minimal local user so the UI works
      return NextResponse.json({
        ok: true,
        user: {
          id: `local_${telegramId}`,
          telegramId,
          name: name ?? 'User',
          username,
          role: 'user',
          subscriptionPlan: 'free',
          subscriptionStatus: 'active',
          applicationsThisMonth: 0,
          isDisabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
