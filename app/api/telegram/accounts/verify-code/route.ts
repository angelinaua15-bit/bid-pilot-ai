/**
 * POST /api/telegram/accounts/verify-code
 *
 * Verifies the Telegram OTP (and optional 2FA password) directly via GramJS on Vercel.
 * Saves the encrypted session_string and marks the account active.
 *
 * Body: { accountId, code, password? }
 */

// Vercel max function duration — GramJS needs up to 40s (20s connect + 20s SignIn)
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  getTelegramOtpSession,
  upsertTelegramAccount,
} from '@/lib/db';
import { signInWithCode } from '@/services/telegram-mtproto.service';

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = await req.json();
    const { accountId: aid, code, password } = body as {
      accountId?: string;
      code?:      string;
      password?:  string;
    };
    accountId = aid;

    if (!accountId || !code) {
      return NextResponse.json(
        { ok: false, error: 'accountId and code are required' },
        { status: 400 }
      );
    }

    console.log('[verify-code] handler', {
      accountId,
      has2fa:    Boolean(password),
      handledBy: 'vercel',
    });

    const [account, otpSession] = await Promise.all([
      getTelegramAccountById(accountId),
      getTelegramOtpSession(accountId),
    ]);

    if (!account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }
    if (!otpSession) {
      return NextResponse.json(
        { ok: false, error: 'OTP session expired — please request a new code' },
        { status: 400 }
      );
    }

    console.log('[verify-code] invoking GramJS signInWithCode', {
      phoneNumber: account.phoneNumber,
      hashPrefix:  otpSession.phoneHash.slice(0, 8),
    });

    // ── Run GramJS directly on Vercel ─────────────────────────────────────────
    const result = await signInWithCode(
      account.phoneNumber,
      otpSession.phoneHash,
      code,
      password ?? undefined,
      otpSession.sessionString ?? undefined,
    );

    // Persist session and mark account active
    await upsertTelegramAccount({
      ...account,
      status:        'active',
      sessionString: result.sessionString,
      lastActiveAt:  new Date().toISOString(),
      errorMessage:  undefined,
      ...(result.telegramId && { telegramId: result.telegramId }),
      ...(result.username   && { username:   result.username }),
      ...(result.firstName  && { displayName: result.firstName }),
    });

    console.log('[verify-code] account activated', {
      phoneNumber: account.phoneNumber,
      telegramId:  result.telegramId,
      username:    result.username,
      handledBy:   'vercel',
    });

    return NextResponse.json({
      ok:         true,
      message:    'Account connected',
      telegramId: result.telegramId,
      username:   result.username,
      firstName:  result.firstName,
      handledBy:  'vercel',
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[verify-code] FAILED', { message, accountId });

    // 2FA required — not a real error, needs password input
    if (message === 'SESSION_PASSWORD_NEEDED' || /SESSION_PASSWORD_NEEDED/i.test(message)) {
      if (accountId) {
        const account = await getTelegramAccountById(accountId).catch(() => null);
        if (account) {
          await upsertTelegramAccount({
            ...account,
            status:       'code_sent',
            errorMessage: '2FA password required',
          }).catch(() => {});
        }
      }
      return NextResponse.json(
        { ok: false, error: '2FA password required', requires2fa: true },
        { status: 422 }
      );
    }

    // Persist error on the account row
    if (accountId) {
      const account = await getTelegramAccountById(accountId).catch(() => null);
      if (account) {
        await upsertTelegramAccount({
          ...account,
          status:       'invalid',
          errorMessage: message,
        }).catch(() => {});
      }
    }

    // Map well-known Telegram error codes
    let friendlyError = message;
    let status = 500;

    if (/PHONE_CODE_INVALID|CODE_INVALID/i.test(message)) {
      friendlyError = 'Invalid verification code';
      status = 400;
    } else if (/PHONE_CODE_EXPIRED|CODE_EXPIRED/i.test(message)) {
      friendlyError = 'Verification code expired — please request a new one';
      status = 400;
    } else if (/FLOOD_WAIT/i.test(message)) {
      const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
      friendlyError = `Too many attempts. Please wait ${seconds} seconds`;
      status = 429;
    } else if (/PASSWORD_HASH_INVALID/i.test(message)) {
      friendlyError = 'Incorrect 2FA password';
      status = 400;
    }

    return NextResponse.json({ ok: false, error: friendlyError }, { status });
  }
}
