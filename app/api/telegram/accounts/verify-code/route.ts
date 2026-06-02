/**
 * POST /api/telegram/accounts/verify-code
 *
 * Calls GramJS MTProto directly (no worker proxy) to verify the OTP.
 * Persists the StringSession in telegram_accounts and marks it active.
 *
 * Body: { accountId, code, password? }
 */
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

    // Validate env vars up front
    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!apiId || !apiHash) {
      console.error('[verify-code] TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server' },
        { status: 503 }
      );
    }

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

    console.log('[verify-code] verifying code for', account.phoneNumber);

    const { sessionString } = await signInWithCode(
      account.phoneNumber,
      otpSession.phoneHash,
      code,
      password,
    );

    console.log('[verify-code] sign-in successful for', account.phoneNumber);

    // Persist session and mark account active
    await upsertTelegramAccount({
      ...account,
      status:        'active',
      sessionString,
      lastActiveAt:  new Date().toISOString(),
      errorMessage:  undefined,
    });

    return NextResponse.json({ ok: true, message: 'Account connected' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[verify-code] error:', message);

    // 2FA required — tell the frontend to show the password field
    if (message.includes('SESSION_PASSWORD_NEEDED')) {
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

    // Map other well-known errors
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
    } else if (/API_ID_INVALID|api_id/i.test(message)) {
      friendlyError = 'Invalid Telegram API credentials';
      status = 503;
    }

    if (accountId) {
      const account = await getTelegramAccountById(accountId).catch(() => null);
      if (account) {
        await upsertTelegramAccount({
          ...account,
          status:       'invalid',
          errorMessage: friendlyError,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: false, error: friendlyError }, { status });
  }
}
