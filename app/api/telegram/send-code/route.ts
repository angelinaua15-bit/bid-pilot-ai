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

type SendCodeBody = {
  accountId?: string;
  phoneNumber?: string;
  userId?: string;
};

function normalizePhone(phone?: string) {
  return phone?.trim().replace(/\s+/g, '') ?? '';
}

function mapTelegramError(message: string) {
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
  } else if (/Cannot send requests while disconnected|disconnect/i.test(message)) {
    friendlyError = 'Telegram client is disconnected. Try again.';
    status = 503;
  }

  return { friendlyError, status };
}

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = (await req.json()) as SendCodeBody;

    accountId = body.accountId;
    const phoneNumber = normalizePhone(body.phoneNumber);
    const userId = body.userId;

    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiId || Number.isNaN(apiId) || !apiHash) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Telegram API credentials not configured on server',
          code: 'TELEGRAM_ENV_MISSING',
          debug: {
            apiIdSet: Boolean(process.env.TELEGRAM_API_ID),
            apiHashSet: Boolean(process.env.TELEGRAM_API_HASH),
            apiIdIsNumber: !Number.isNaN(apiId) && Boolean(apiId),
          },
        },
        { status: 503 }
      );
    }

    let account = accountId ? await getTelegramAccountById(accountId) : null;

    if (!account && phoneNumber) {
      if (!userId) {
        return NextResponse.json(
          {
            ok: false,
            error: 'userId is required when creating a new account',
          },
          { status: 400 }
        );
      }

      const existingAccounts = await getTelegramAccounts(userId);
      const existingAccount = existingAccounts.find(
        (item) => normalizePhone(item.phoneNumber) === phoneNumber
      );

      if (existingAccount) {
        account = existingAccount;
        accountId = existingAccount.id;
      } else {
        const createdAccount = await upsertTelegramAccount({
          userId,
          phoneNumber,
          status: 'pending',
          errorMessage: undefined,
        });

        if (!createdAccount) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Failed to create account record',
            },
            { status: 500 }
          );
        }

        account = createdAccount;
        accountId = createdAccount.id;
      }
    }

    if (!account || !accountId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'accountId or phoneNumber is required',
        },
        { status: 400 }
      );
    }

    console.log(
      `SEND_CODE_STARTED — accountId:${accountId} phone:${account.phoneNumber}`
    );

    const result = await sendTelegramCode(account.phoneNumber);

    if (!result?.phoneHash || !result?.sessionString) {
      throw new Error('SEND_CODE_FAILED_EMPTY_RESULT');
    }

    console.log(
      `SEND_CODE_SUCCESS — phone:${account.phoneNumber} isCodeViaApp:${result.isCodeViaApp} hashPrefix:${result.phoneHash.slice(0, 8)}`
    );

    await saveTelegramOtpSession(
      accountId,
      result.phoneHash,
      result.sessionString
    );

    await upsertTelegramAccount({
      ...account,
      status: 'code_sent',
      errorMessage: undefined,
    });

    return NextResponse.json({
      ok: true,
      accountId,
      message: 'Code sent',
      isCodeViaApp: Boolean(result.isCodeViaApp),
      phoneHashExists: true,
      handledBy: 'vercel',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { friendlyError, status } = mapTelegramError(message);

    console.error(
      `SEND_CODE_FAILED — accountId:${accountId ?? 'unknown'} error:${message}`
    );

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
        handledBy: 'vercel',
      },
      { status }
    );
  }
}