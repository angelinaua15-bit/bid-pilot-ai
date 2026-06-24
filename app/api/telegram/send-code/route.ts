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

type Body = {
  accountId?: string;
  phoneNumber?: string;
  userId?: string;
};

function cleanPhone(phone?: string) {
  return phone?.trim().replace(/\s+/g, '') ?? '';
}

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = (await req.json()) as Body;

    accountId = body.accountId;
    const phoneNumber = cleanPhone(body.phoneNumber);
    const userId = body.userId;

    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiId || Number.isNaN(apiId) || !apiHash) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Telegram API credentials not configured',
          code: 'TELEGRAM_ENV_MISSING',
          phoneHashExists: false,
        },
        { status: 503 }
      );
    }

    let account = accountId ? await getTelegramAccountById(accountId) : null;

    if (!account && phoneNumber) {
      if (!userId) {
        return NextResponse.json(
          { ok: false, error: 'userId is required', phoneHashExists: false },
          { status: 400 }
        );
      }

      const accounts = await getTelegramAccounts(userId);
      const found = accounts.find(
        (item) => cleanPhone(item.phoneNumber) === phoneNumber
      );

      if (found) {
        account = found;
        accountId = found.id;
      } else {
        const created = await upsertTelegramAccount({
          userId,
          phoneNumber,
          status: 'pending',
          errorMessage: undefined,
        });

        if (!created) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Failed to create Telegram account',
              phoneHashExists: false,
            },
            { status: 500 }
          );
        }

        account = created;
        accountId = created.id;
      }
    }

    if (!account || !accountId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'accountId or phoneNumber is required',
          phoneHashExists: false,
        },
        { status: 400 }
      );
    }

    console.log(
      `SEND_CODE_STARTED accountId:${accountId} phone:${account.phoneNumber}`
    );

    const result = await sendTelegramCode(account.phoneNumber);

    if (!result.phoneHash || !result.sessionString) {
      throw new Error('SEND_CODE_EMPTY_RESULT');
    }

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
      isCodeViaApp: result.isCodeViaApp,
      codeType: result.codeType,
      nextType: result.nextType ?? null,
      timeout: result.timeout ?? null,
      phoneHashExists: true,
      handledBy: 'vercel',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    console.error(
      `SEND_CODE_FAILED accountId:${accountId ?? 'unknown'} error:${message}`
    );

    let error = message;
    let status = 500;

    if (/PHONE_NUMBER_INVALID/i.test(message)) {
      error = 'Невірний формат номера телефону';
      status = 400;
    } else if (/PHONE_NUMBER_BANNED/i.test(message)) {
      error = 'Цей номер заблокований Telegram';
      status = 403;
    } else if (/FLOOD_WAIT/i.test(message)) {
      const seconds = message.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
      error = `Забагато спроб. Зачекайте ${seconds} сек.`;
      status = 429;
    } else if (/API_ID_INVALID|TELEGRAM_ENV_MISSING/i.test(message)) {
      error = 'Невірні Telegram API дані';
      status = 503;
    } else if (/timeout|timed out/i.test(message)) {
      error = 'Не вдалося з’єднатися з Telegram. Спробуйте ще раз.';
      status = 503;
    }

    if (accountId) {
      const account = await getTelegramAccountById(accountId).catch(() => null);

      if (account) {
        await upsertTelegramAccount({
          ...account,
          status: /FLOOD_WAIT/i.test(message) ? 'flood_wait' : 'invalid',
          errorMessage: error,
        }).catch(() => {});
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error,
        telegramError: message,
        phoneHashExists: false,
        handledBy: 'vercel',
      },
      { status }
    );
  }
}