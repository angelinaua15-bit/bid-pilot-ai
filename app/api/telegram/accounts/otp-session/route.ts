/**
 * DELETE /api/telegram/accounts/otp-session?accountId=<id>
 *
 * Clears the stored OTP session (phoneHash + sessionString) for an account
 * so that the next sendCode call creates a completely fresh TelegramClient.
 */

export const maxDuration = 10;

import { NextRequest, NextResponse } from 'next/server';
import { clearTelegramOtpSession } from '@/lib/db';
import { assertAdmin } from '@/lib/auth';

export async function DELETE(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId');
  const requesterId = req.nextUrl.searchParams.get('requesterId');

  const admin = await assertAdmin(requesterId);
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Forbidden: admin access required' }, { status: 403 });
  }

  if (!accountId) {
    return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
  }
  try {
    await clearTelegramOtpSession(accountId);
    console.log(`OTP_SESSION_CLEARED — accountId:${accountId}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`OTP_SESSION_CLEAR_FAILED — accountId:${accountId} error:${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
