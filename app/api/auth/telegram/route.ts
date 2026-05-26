/**
 * POST /api/auth/telegram
 * Validate Telegram initData and return/create user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData, parseTelegramUser } from '@/services/telegram.service';
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

    // TODO: Find or create user in DB:
    // const user = await prisma.user.upsert({
    //   where: { telegramId: telegramUser.id },
    //   update: { name: telegramUser.first_name, username: telegramUser.username },
    //   create: { telegramId: telegramUser.id, name: telegramUser.first_name, username: telegramUser.username },
    //   include: { profile: true, subscription: true, freelancehunt: true },
    // });

    return NextResponse.json({ ok: true, data: mockUser });
  } catch (err) {
    console.error('[POST /api/auth/telegram]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
