/**
 * POST /api/telegram/accounts/send-code
 *
 * Calls GramJS MTProto directly on Vercel to send a login OTP.
 * Saves the phoneHash in telegram_otp_sessions and updates account status.
 *
 * Body: { accountId, requesterId? }
 */

// Vercel max function duration — must fit within connect(20s) + SendCode(25s) = 45s
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
} from '@/lib/db';
import { sendTelegramCode } from '@/services/telegram-mtproto.service';

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body        = await req.json();
    accountId         = (body as { accountId?: string }).accountId;
    const requesterId = (body as { requesterId?: string }).requesterId ?? null;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    // Validate env vars up front — give a clear error instead of a cryptic GramJS crash
    const rawApiId = process.env.TELEGRAM_API_ID;
    const apiHash  = process.env.TELEGRAM_API_HASH ?? '';
    const apiId    = Number(rawApiId ?? 0);
    const apiIdSet   = Boolean(rawApiId);
    const apiHashSet = Boolean(apiHash);

    console.log('[send-code] handler', {
      accountId,
      requesterId:   requesterId ?? '(not provided)',
      apiIdSet,
      apiHashSet,
      apiIdValue:    apiIdSet ? apiId : '(not set)',
      apiIdValid:    apiIdSet && Number.isFinite(apiId) && apiId > 0,
      handledBy:     'vercel',
    });

    if (!apiIdSet || !apiHashSet) {
      console.error('[send-code] TELEGRAM_ENV_MISSING — TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'TELEGRAM_ENV_MISSING: Змінні TELEGRAM_API_ID / TELEGRAM_API_HASH не налаштовані на сервері', phoneHashExists: false },
        { status: 503 }
      );
    }
    if (!Number.isFinite(apiId) || apiId <= 0) {
      console.error(`[send-code] API_ID_INVALID — TELEGRAM_API_ID="${rawApiId}" is not a valid number`);
      return NextResponse.json(
        { ok: false, error: `API_ID_INVALID: TELEGRAM_API_ID="${rawApiId}" не є числом`, phoneHashExists: false },
        { status: 503 }
      );
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      console.error('[send-code] account not found', { accountId });
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    console.log(`SEND_CODE_STARTED — accountId:${accountId} phone:${account.phoneNumber} status:${account.status}`);

    // ── Run GramJS directly on Vercel ─────────────────────────────────────────
    const result = await sendTelegramCode(account.phoneNumber);

    // Persist OTP session and advance account status
    await Promise.all([
      saveTelegramOtpSession(accountId, result.phoneHash, result.sessionString),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);
    console.log(`PHONE_CODE_HASH_SAVED — accountId:${accountId} hashPrefix:${result.phoneHash.slice(0, 8)}`);

    console.log(
      `SEND_CODE_SUCCESS — phone:${account.phoneNumber}` +
      ` isCodeViaApp:${result.isCodeViaApp}` +
      ` codeType:${result.codeType}` +
      ` nextType:${result.nextType ?? 'none'}` +
      ` timeout:${result.timeout ?? 'none'}` +
      ` hashPrefix:${result.phoneHash.slice(0, 8)} handledBy:vercel`
    );

    return NextResponse.json({
      ok:              true,
      message:         'Code sent',
      isCodeViaApp:    result.isCodeViaApp,
      phoneHashExists: true,
      handledBy:       'vercel',
      // Full Telegram delivery details for the UI
      codeType:        result.codeType,
      nextType:        result.nextType ?? null,
      timeout:         result.timeout ?? null,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`SEND_CODE_FAILED — accountId:${accountId ?? 'unknown'} error: ${message}`);

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

    // Map well-known Telegram errors to Ukrainian friendly messages
    let friendlyError = message;
    let status = 500;

    if (/TELEGRAM_ENV_MISSING/i.test(message)) {
      friendlyError = 'Змінні TELEGRAM_API_ID / TELEGRAM_API_HASH не налаштовані на сервері';
      status = 503;
    } else if (/API_ID_INVALID/i.test(message)) {
      friendlyError = 'TELEGRAM_API_ID не є коректним числом або заблокований Telegram';
      status = 503;
    } else if (/PHONE_NUMBER_INVALID|INVALID_PHONE/i.test(message)) {
      friendlyError = 'Невірний формат номера телефону';
      status = 400;
    } else if (/PHONE_NUMBER_BANNED/i.test(message)) {
      friendlyError = 'Цей номер телефону заблокований у Telegram';
      status = 403;
    } else if (/FLOOD_WAIT/i.test(message)) {
      const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
      friendlyError = `Забагато спроб. Зачекайте ${seconds} секунд.`;
      status = 429;
    } else if (/API_ID_INVALID|api_id/i.test(message)) {
      friendlyError = 'Невірні облікові дані Telegram API (API_ID_INVALID)';
      status = 503;
    } else if (/^Unauthorized$|UNAUTHORIZED/i.test(message)) {
      friendlyError =
        'Telegram відхилив запит (401). ' +
        'api_id може бути заблокований з хмарних IP — створіть новий додаток на my.telegram.org.';
      status = 503;
    } else if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|timed out/i.test(message)) {
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
