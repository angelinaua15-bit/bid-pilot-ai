/**
 * POST /api/telegram/accounts/send-code
 *
 * Calls GramJS MTProto directly on Vercel to send a login OTP.
 * Saves the phoneHash in telegram_otp_sessions and updates account status.
 *
 * Body: { accountId, requesterId? }
 */
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
    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';

    console.log('[send-code] handler', {
      accountId,
      requesterId:   requesterId ?? '(not provided)',
      apiIdSet:      Boolean(apiId),
      apiHashLen:    apiHash.length,
      handledBy:     'vercel',
    });

    if (!apiId || !apiHash) {
      console.error('[send-code] TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server', phoneHashExists: false },
        { status: 503 }
      );
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      console.error('[send-code] account not found', { accountId });
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    console.log('[send-code] account found, invoking GramJS sendTelegramCode', {
      phoneNumber: account.phoneNumber,
      status:      account.status,
    });

    // ── Run GramJS directly on Vercel ─────────────────────────────────────────
    const result = await sendTelegramCode(account.phoneNumber);

    // Persist OTP session and advance account status
    await Promise.all([
      saveTelegramOtpSession(accountId, result.phoneHash, result.sessionString),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);

    console.log('[send-code] success', {
      phoneNumber:  account.phoneNumber,
      isCodeViaApp: result.isCodeViaApp,
      hashPrefix:   result.phoneHash.slice(0, 8),
      handledBy:    'vercel',
    });

    return NextResponse.json({
      ok:              true,
      message:         'Code sent',
      isCodeViaApp:    result.isCodeViaApp,
      phoneHashExists: true,
      handledBy:       'vercel',
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-code] FAILED', { message, accountId });

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

    // Map well-known Telegram errors to friendly messages
    let friendlyError = message;
    let status = 500;

    if (/PHONE_NUMBER_INVALID|INVALID_PHONE/i.test(message)) {
      friendlyError = 'Invalid phone number format';
      status = 400;
    } else if (/PHONE_NUMBER_BANNED/i.test(message)) {
      friendlyError = 'This phone number is banned by Telegram';
      status = 403;
    } else if (/FLOOD_WAIT/i.test(message)) {
      const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
      friendlyError = `Too many attempts. Please wait ${seconds} seconds`;
      status = 429;
    } else if (/API_ID_INVALID|api_id/i.test(message)) {
      friendlyError = 'Invalid Telegram API credentials (API_ID_INVALID)';
      status = 503;
    } else if (/^Unauthorized$|UNAUTHORIZED/i.test(message)) {
      friendlyError =
        'Telegram rejected the request (401 Unauthorized). ' +
        'The api_id may be blocked on cloud IPs — create a new app at my.telegram.org.';
      status = 503;
    } else if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|timed out/i.test(message)) {
      friendlyError = 'Cannot reach Telegram servers. Check network connection.';
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
