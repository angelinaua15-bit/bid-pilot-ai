/**
 * POST /api/telegram/send-code
 *
 * Alias / flat route — accepts either { phoneNumber } for first-time registration
 * or { accountId } to re-send to an existing account.
 *
 * When phoneNumber is given without an accountId, creates a pending account first.
 */

// Vercel max function duration — GramJS needs up to 45s (20s connect + 25s SendCode)
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
  getTelegramAccounts,
} from '@/lib/db';
import { sendTelegramCode } from '@/services/telegram-mtproto.service';

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = await req.json() as {
      accountId?:   string;
      phoneNumber?: string;
      userId?:      string;
    };
    accountId = body.accountId;
    const phoneNumber = body.phoneNumber?.trim();
    const userId      = body.userId;

    // Validate env vars
    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!apiId || !apiHash) {
      console.error('[send-code] TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server' },
        { status: 503 }
      );
    }

    let account = accountId ? await getTelegramAccountById(accountId) : null;

    // If no accountId but phoneNumber provided — create or find account
    if (!account && phoneNumber) {
      if (!userId) {
        return NextResponse.json({ ok: false, error: 'userId is required when creating a new account' }, { status: 400 });
      }

      // Check if an account with this phone already exists for this user
      const existing = await getTelegramAccounts(userId);
      const found = existing.find((a) => a.phoneNumber === phoneNumber);
      if (found) {
        account   = found;
        accountId = found.id;
      } else {
        // Create a pending account
        const created = await upsertTelegramAccount({
          userId,
          phoneNumber,
          status: 'pending',
        });
        if (!created) {
          return NextResponse.json({ ok: false, error: 'Failed to create account record' }, { status: 500 });
        }
        account   = created;
        accountId = created.id;
      }
    }

    if (!account || !accountId) {
      return NextResponse.json({ ok: false, error: 'accountId or phoneNumber is required' }, { status: 400 });
    }

    console.log(`SEND_CODE_STARTED — accountId:${accountId} phone:${account.phoneNumber}`);

    const { phoneHash, isCodeViaApp, sessionString } = await sendTelegramCode(account.phoneNumber);

    console.log(`SEND_CODE_SUCCESS — phone:${account.phoneNumber} isCodeViaApp:${isCodeViaApp} hashPrefix:${phoneHash?.slice(0, 8)}`);

    await Promise.all([
      saveTelegramOtpSession(accountId, phoneHash, sessionString),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);

    return NextResponse.json({ ok: true, accountId, message: 'Code sent', isCodeViaApp });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`SEND_CODE_FAILED — accountId:${accountId ?? 'unknown'} error: ${message}`);

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
      friendlyError = 'Invalid Telegram API credentials';
      status = 503;
    }

    if (accountId) {
      const account = await getTelegramAccountById(accountId).catch(() => null);
      if (account) {
        await upsertTelegramAccount({
          ...account,
          status:       /FLOOD_WAIT/i.test(message) ? 'flood_wait' : 'invalid',
          errorMessage: friendlyError,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: false, error: friendlyError }, { status });
  }
}
