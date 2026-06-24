/**
 * POST /api/telegram/send-code
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
  getTelegramAccounts,
} from '@/lib/db';
import { sendTelegramCode } from '@/services/telegram-mtproto.service';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = (await req.json()) as {
      accountId?: string;
      phoneNumber?: string;
      userId?: string;
    };

    if (process.env.TELEGRAM_AUTH_VIA_WORKER === 'true') {
      const workerUrl = process.env.AUTOMATION_WORKER_URL;
      const secret = process.env.AUTOMATION_SECRET;

      if (!workerUrl || !secret) {
        return NextResponse.json(
          { ok: false, error: 'Worker env missing' },
          { status: 500 }
        );
      }

      const res = await fetch(`${workerUrl}/telegram/accounts/send-code`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-automation-secret': secret,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({
        ok: false,
        error: 'Invalid worker response',
      }));

      return NextResponse.json(data, { status: res.status });
    }

    accountId = body.accountId;
    const phoneNumber = body.phoneNumber?.trim();
    const userId = body.userId;

    const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';

    if (!apiId || !apiHash) {
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server' },
        { status: 503 }
      );
    }

    let account = accountId ? await getTelegramAccountById(accountId) : null;

    if (!account && phoneNumber) {
      if (!userId) {
        return NextResponse.json(
          { ok: false, error: 'userId is required when creating a new account' },
          { status: 400 }
        );
      }

      const existing = await getTelegramAccounts(userId);
      const found = existing.find((a) => a.phoneNumber === phoneNumber);

      if (found) {
        account = found;
        accountId = found.id;
      } else {
        const created = await upsertTelegramAccount({
          userId,
          phoneNumber,
          status: 'pending',
        });

        if (!created) {
          return NextResponse.json(
            { ok: false, error: 'Failed to create account record' },
            { status: 500 }
          );
        }

        account = created;
        accountId = created.id;
      }
    }

    if (!account || !accountId) {
      return NextResponse.json(
        { ok: false, error: 'accountId or phoneNumber is required' },
        { status: 400 }
      );
    }

    console.log(`SEND_CODE_STARTED — accountId:${accountId} phone:${account.phoneNumber}`);

    const { phoneHash, isCodeViaApp, sessionString } = await sendTelegramCode(
      account.phoneNumber
    );

    console.log(
      `SEND_CODE_SUCCESS — phone:${account.phoneNumber} isCodeViaApp:${isCodeViaApp} hashPrefix:${phoneHash?.slice(0, 8)}`
    );

    await Promise.all([
      saveTelegramOtpSession(accountId, phoneHash, sessionString),
      upsertTelegramAccount({
        ...account,
        status: 'code_sent',
        errorMessage: undefined,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      accountId,
      message: 'Code sent',
      isCodeViaApp,
      phoneHashExists: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    console.error(
      `SEND_CODE_FAILED — accountId:${accountId ?? 'unknown'} error: ${message}`
    );

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
    } else if (/timed out|timeout/i.test(message)) {
      friendlyError = 'Telegram connection timed out. Try again later.';
      status = 503;
    }

    if (accountId) {
      const account = await getTelegramAccountById(accountId).catch(() => null);

      if (account) {
        await upsertTelegramAccount({
          ...account,
          status: /FLOOD_WAIT/i.test(message) ? 'flood_wait' : 'invalid',
          errorMessage: friendlyError,
        }).catch(() => {});
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: friendlyError,
        telegramError: message,
        phoneHashExists: false,
      },
      { status }
    );
  }
}