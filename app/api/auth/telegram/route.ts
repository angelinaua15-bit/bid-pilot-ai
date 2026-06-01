/**
 * POST /api/auth/telegram
 * Validate Telegram initData and return/create user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData, parseTelegramUser } from '@/services/telegram.service';
import { getOrCreateUser } from '@/lib/db';
import { mockUser } from '@/lib/mock-data';

export async function POST(req: NextRequest) {
  try {
    const { initData } = await req.json();

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';

    // In browser/dev mode (no initData) — return mock user so preview still works
    if (!initData) {
      console.warn('[auth/telegram] No initData — returning mock user (browser preview mode)');
      return NextResponse.json({ ok: true, data: mockUser, _preview: true });
    }

    const isValid = validateTelegramInitData(initData, botToken);
    if (!isValid) {
      return NextResponse.json({ ok: false, error: 'Invalid initData' }, { status: 401 });
    }

    const telegramUser = parseTelegramUser(initData);
    if (!telegramUser) {
      return NextResponse.json({ ok: false, error: 'User not found in initData' }, { status: 400 });
    }

    const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ');
    const user = await getOrCreateUser(
      telegramUser.id,
      fullName || telegramUser.username || `user_${telegramUser.id}`,
      telegramUser.username,
    );

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Failed to create user' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: user });
  } catch (err) {
    console.error('[POST /api/auth/telegram]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
