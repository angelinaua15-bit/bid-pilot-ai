/**
 * POST /api/telegram/accounts/resend-code
 *
 * Calls auth.ResendCode with the existing phoneHash so Telegram delivers
 * the code via the nextType (e.g. SMS or phone call instead of app message).
 * Overwrites the OTP session with the new hash returned by Telegram.
 *
 * Body: { accountId }
 */

// Vercel max function duration — connect(20s) + ResendCode(25s) = 45s max
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  getTelegramOtpSession,
  saveTelegramOtpSession,
  upsertTelegramAccount,
} from '@/lib/db';
import { resendTelegramCode } from '@/services/telegram-mtproto.service';
import { assertAdmin } from '@/lib/auth';

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = await req.json();
    accountId = (body as { accountId?: string; requesterId?: string }).accountId;
    const requesterId = (body as { requesterId?: string }).requesterId;

    // Admin-only
    const admin = await assertAdmin(requesterId ?? null);
    if (!admin) {
      console.warn(`[resend-code] FORBIDDEN — requesterId:${requesterId ?? 'none'}`);
      return NextResponse.json(
        { ok: false, error: 'Forbidden: admin access required', phoneHashExists: false },
        { status: 403 }
      );
    }

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!apiId || !apiHash) {
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server', phoneHashExists: false },
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
      // No valid OTP session — caller should fall back to a fresh sendCode
      return NextResponse.json(
        {
          ok:              false,
          error:           'OTP session expired or not found — please start over',
          sessionExpired:  true,
          phoneHashExists: false,
        },
        { status: 400 }
      );
    }

    console.log(`RESEND_CODE_STARTED — accountId:${accountId} phone:${account.phoneNumber} hashPrefix:${otpSession.phoneHash.slice(0, 8)}`);

    const result = await resendTelegramCode(
      account.phoneNumber,
      otpSession.phoneHash,
      otpSession.sessionString ?? '',
    );

    // Overwrite OTP session with the new hash (ResendCode always returns a new hash)
    await Promise.all([
      saveTelegramOtpSession(accountId, result.phoneHash, result.sessionString),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);

    console.log(
      `RESEND_CODE_SUCCESS — phone:${account.phoneNumber}` +
      ` codeType:${result.codeType} nextType:${result.nextType ?? 'none'}` +
      ` timeout:${result.timeout ?? 'none'} isCodeViaApp:${result.isCodeViaApp}`
    );

    return NextResponse.json({
      ok:              true,
      message:         'Code resent',
      isCodeViaApp:    result.isCodeViaApp,
      phoneHashExists: true,
      codeType:        result.codeType,
      nextType:        result.nextType ?? null,
      timeout:         result.timeout ?? null,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`RESEND_CODE_FAILED — accountId:${accountId ?? 'unknown'} error: ${message}`);

    let friendlyError = message;
    let status = 500;

    if (/PHONE_NUMBER_INVALID|INVALID_PHONE/i.test(message)) {
      friendlyError = 'Невірний формат номера телефону';
      status = 400;
    } else if (/PHONE_CODE_EXPIRED|CODE_EXPIRED/i.test(message)) {
      friendlyError = 'Код протермінований — почніть заново';
      status = 400;
    } else if (/FLOOD_WAIT/i.test(message)) {
      const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
      friendlyError = `Забагато спроб. Зачекайте ${seconds} секунд`;
      status = 429;
    } else if (/AUTH_RESTART/i.test(message)) {
      friendlyError = 'Telegram вимагає перезапуску авторизації — почніть заново';
      status = 400;
    } else if (/ECONNREFUSED|ENOTFOUND|timed out|fetch failed/i.test(message)) {
      friendlyError = 'Не вдалось зʼєднатися з Telegram. Перевірте мережу.';
      status = 503;
    }

    return NextResponse.json(
      {
        ok:              false,
        error:           friendlyError,
        telegramError:   message,
        phoneHashExists: false,
      },
      { status }
    );
  }
}
