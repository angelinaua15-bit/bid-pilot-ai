import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, getUserById, updateUserPlan, disableUser } from '@/lib/db';
import { assertAdmin } from '@/lib/auth';
import { OWNER_TELEGRAM_ID } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requesterId = searchParams.get('requesterId') ?? '';
    const requester = await assertAdmin(requesterId);
    if (!requester) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    const users = await getAllUsers(200);
    return NextResponse.json({ ok: true, users });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { requesterId, userId, plan, expiresAt, disabled } = await req.json();
    const requester = await assertAdmin(requesterId);
    if (!requester) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    // Prevent non-owner from modifying the owner account
    const target = await getUserById(userId);
    if (target?.telegramId === OWNER_TELEGRAM_ID && requester.role !== 'owner') {
      return NextResponse.json({ ok: false, error: 'Cannot modify owner account' }, { status: 403 });
    }
    if (plan !== undefined) await updateUserPlan(userId, plan, expiresAt);
    if (disabled !== undefined) await disableUser(userId, disabled);
    const updated = await getUserById(userId);
    return NextResponse.json({ ok: true, user: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
