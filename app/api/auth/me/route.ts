/**
 * POST /api/auth/me
 * Resolves or creates a SaaS user from Telegram identity data.
 * Called on every app load — idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateUser } from '@/lib/db';
import { OWNER_TELEGRAM_ID } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { telegramId, name, username } = await req.json();
    if (!telegramId || typeof telegramId !== 'number') {
      return NextResponse.json({ ok: false, error: 'telegramId required' }, { status: 400 });
    }

    const isOwner = Number(telegramId) === OWNER_TELEGRAM_ID;

    const user = await getOrCreateUser(Number(telegramId), String(name ?? 'User'), username);
    if (!user) {
      // Supabase not configured — return a minimal local user so the UI works.
      // Owner always gets unlimited access regardless of DB availability.
      return NextResponse.json({
        ok: true,
        user: {
          id: `local_${telegramId}`,
          telegramId,
          name: name ?? 'User',
          username,
          role: isOwner ? 'owner' : 'user',
          subscriptionPlan: isOwner ? 'unlimited' : 'free',
          subscriptionStatus: 'active',
          applicationsThisMonth: 0,
          isDisabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }

    // Even if Supabase returned a user, enforce owner fields in-memory in case
    // the DB record was created before the owner migration ran.
    if (isOwner && (user.role !== 'owner' || user.subscriptionPlan !== 'unlimited')) {
      return NextResponse.json({
        ok: true,
        user: { ...user, role: 'owner', subscriptionPlan: 'unlimited', subscriptionStatus: 'active' },
      });
    }

    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
