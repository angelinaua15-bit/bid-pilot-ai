/**
 * POST /api/telegram/accounts/test
 *
 * Tests an active Telegram MTProto session by calling auth.exportLoginToken
 * (a cheap, auth-validated request). Returns ok: true if the session is valid.
 *
 * Body: { accountId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTelegramAccountById, upsertTelegramAccount } from '@/lib/db';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { accountId?: string };
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!apiId || !apiHash) {
      return NextResponse.json({ ok: false, error: 'Telegram API credentials not configured' }, { status: 503 });
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }
    if (account.status !== 'active' || !account.sessionString) {
      return NextResponse.json({ ok: false, error: 'Account is not active or has no session' }, { status: 400 });
    }

    const logger = new Logger(LogLevel.ERROR);

    const session = new StringSession(account.sessionString);
    const client  = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 1,
      retryDelay:        500,
      // useWSS:true required on Vercel/Railway — raw TCP is blocked
      useWSS:            true,
      baseLogger:        logger,
    });

    console.log('[test-connection] connecting for', account.phoneNumber);
    await client.connect();

    try {
      // GetUsers with InputUserSelf is the cheapest authenticated call
      const meResult = await client.invoke(new Api.users.GetUsers({
        id: [new Api.InputUserSelf()],
      })) as Api.User[];
      const me = meResult?.[0];

      console.log('[test-connection] session valid for', account.phoneNumber,
        '— id:', me?.id?.toString(), 'username:', me?.username);

      // Update lastActiveAt and any new user info from getMe
      await upsertTelegramAccount({
        ...account,
        lastActiveAt: new Date().toISOString(),
        status:       'active',
        errorMessage: undefined,
        ...(me?.id       && { telegramId: String(me.id) }),
        ...(me?.username && { username: me.username }),
      }).catch(() => {});

      return NextResponse.json({
        ok:         true,
        message:    'Session is valid',
        telegramId: me?.id?.toString(),
        username:   me?.username,
        firstName:  me?.firstName,
      });
    } catch (invokeErr) {
      const msg = (invokeErr as Error)?.message ?? '';
      console.error('[test-connection] invoke error:', msg);

      // Session is expired/invalid — mark accordingly
      if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(msg)) {
        await upsertTelegramAccount({
          ...account,
          status:       'invalid',
          errorMessage: 'Сесія недійсна або відкликана — підключіть аккаунт знову',
        }).catch(() => {});
        return NextResponse.json({ ok: false, error: 'Session revoked — reconnect the account' }, { status: 401 });
      }

      return NextResponse.json({ ok: false, error: msg || 'Connection test failed' }, { status: 500 });
    } finally {
      client.disconnect().catch(() => {});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[test-connection] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
