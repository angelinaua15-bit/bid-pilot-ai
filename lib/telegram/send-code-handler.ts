/**
 * Shared send-code handler used by both:
 *   - POST /api/telegram/send-code
 *   - POST /api/telegram/accounts/send-code
 *
 * Rules:
 *  - ok:true ONLY if Telegram returned a real, new phoneCodeHash
 *  - ok:false for ANY connection/timeout/API error — never fake success
 *  - Old session is cleared BEFORE calling sendTelegramCode
 *  - Account status is set to 'code_sent' ONLY after hash is saved
 *  - Full debug fields returned in every response
 */

import { NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
  clearTelegramOtpSession,
} from '@/lib/db';
import { sendTelegramCode } from '@/services/telegram-mtproto.service';

export interface SendCodeHandlerOptions {
  accountId: string;
  /** Optional label shown in logs */
  requesterId?: string | null;
}

export interface SendCodeHandlerDebug {
  handledBy: 'vercel';
  accountId: string;
  phoneHashExists: boolean;
  codeType?: string;
  isCodeViaApp?: boolean;
  errorCode?: string;
}

function mapError(message: string): { error: string; status: number; errorCode: string } {
  if (/TELEGRAM_ENV_MISSING/i.test(message)) {
    return { error: 'Змінні TELEGRAM_API_ID / TELEGRAM_API_HASH не налаштовані на сервері', status: 503, errorCode: 'TELEGRAM_ENV_MISSING' };
  }
  if (/API_ID_INVALID/i.test(message)) {
    return { error: 'TELEGRAM_API_ID недійсний або заблокований Telegram', status: 503, errorCode: 'API_ID_INVALID' };
  }
  if (/PHONE_NUMBER_INVALID|INVALID_PHONE/i.test(message)) {
    return { error: 'Невірний формат номера телефону', status: 400, errorCode: 'PHONE_NUMBER_INVALID' };
  }
  if (/PHONE_NUMBER_BANNED/i.test(message)) {
    return { error: 'Цей номер заблокований Telegram', status: 403, errorCode: 'PHONE_NUMBER_BANNED' };
  }
  if (/FLOOD_WAIT/i.test(message)) {
    const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
    return { error: `Забагато спроб. Зачекайте ${seconds} сек.`, status: 429, errorCode: 'FLOOD_WAIT' };
  }
  if (/UNAUTHORIZED|401/i.test(message)) {
    return { error: 'Telegram відхилив api_id — перевірте my.telegram.org', status: 503, errorCode: 'UNAUTHORIZED' };
  }
  if (/timeout|timed out|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return { error: 'Не вдалося зʼєднатися з Telegram. Спробуйте ще раз.', status: 503, errorCode: 'CONNECT_TIMEOUT' };
  }
  return { error: message, status: 500, errorCode: 'UNKNOWN' };
}

export async function handleSendCode(
  opts: SendCodeHandlerOptions
): Promise<NextResponse> {
  const { accountId, requesterId } = opts;

  console.log(`SEND_CODE_REQUEST_RECEIVED — accountId:${accountId} requesterId:${requesterId ?? 'none'}`);

  const account = await getTelegramAccountById(accountId);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: 'Account not found', phoneHashExists: false, handledBy: 'vercel', accountId },
      { status: 404 }
    );
  }

  // ── Step 1: Clear any existing OTP session before creating a new one ─────
  // This ensures no stale phoneCodeHash or temp session is ever reused.
  console.log(`OLD_SESSION_CLEARED — accountId:${accountId}`);
  await clearTelegramOtpSession(accountId);

  // ── Step 2: Reset account status to 'pending' so partial state is clean ──
  await upsertTelegramAccount({ ...account, status: 'pending', errorMessage: undefined })
    .catch(() => {});

  // ── Step 3: Run MTProto sendCode ──────────────────────────────────────────
  console.log(`CLIENT_CREATED — phone:${account.phoneNumber}`);

  let result: Awaited<ReturnType<typeof sendTelegramCode>>;

  try {
    result = await sendTelegramCode(account.phoneNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`SEND_CODE_FAILED — accountId:${accountId} reason:${message}`);

    const { error, status, errorCode } = mapError(message);

    // Set account to error state — do NOT set code_sent
    await upsertTelegramAccount({
      ...account,
      status: /FLOOD_WAIT/i.test(message) ? 'flood_wait' : 'invalid',
      errorMessage: error,
    }).catch(() => {});

    const debug: SendCodeHandlerDebug = {
      handledBy: 'vercel',
      accountId,
      phoneHashExists: false,
      errorCode,
    };

    return NextResponse.json(
      { ok: false, error, telegramError: message, ...debug },
      { status }
    );
  }

  // ── Step 4: Guard — ok:true ONLY if we have a real hash ──────────────────
  if (!result.phoneHash || !result.sessionString) {
    console.error(`PHONE_CODE_HASH_MISSING — accountId:${accountId}`);
    await upsertTelegramAccount({ ...account, status: 'invalid', errorMessage: 'PHONE_CODE_HASH_MISSING' }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: 'Telegram не повернув phoneCodeHash', phoneHashExists: false, handledBy: 'vercel', accountId, errorCode: 'PHONE_CODE_HASH_MISSING' },
      { status: 500 }
    );
  }

  // ── Step 5: Persist new OTP session ───────────────────────────────────────
  await saveTelegramOtpSession(accountId, result.phoneHash, result.sessionString);
  console.log(`PHONE_CODE_HASH_RECEIVED — accountId:${accountId} hashPrefix:${result.phoneHash.slice(0, 8)}`);

  // ── Step 6: Advance account status ONLY after hash is saved ──────────────
  await upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined });
  console.log(`AUTH_SEND_CODE_SUCCESS — accountId:${accountId} isCodeViaApp:${result.isCodeViaApp} codeType:${result.codeType}`);

  const debug: SendCodeHandlerDebug = {
    handledBy: 'vercel',
    accountId,
    phoneHashExists: true,
    codeType: result.codeType,
    isCodeViaApp: result.isCodeViaApp,
  };

  return NextResponse.json({
    ok: true,
    message: 'Code sent',
    isCodeViaApp: result.isCodeViaApp,
    codeType: result.codeType,
    nextType: result.nextType ?? null,
    timeout: result.timeout ?? null,
    ...debug,
  });
}
