/**
 * POST /api/telegram/accounts/verify-code
 *
 * Pure proxy to the Railway worker.
 * No GramJS / TelegramClient runs on Vercel — all MTProto happens on Railway.
 *
 * Body: { accountId, code, password? }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  getTelegramOtpSession,
  upsertTelegramAccount,
} from '@/lib/db';

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

    // ── Require Railway worker — GramJS never runs on Vercel ─────────────────
    const workerUrl    = process.env.AUTOMATION_WORKER_URL?.replace(/\/$/, '');
    const workerSecret = process.env.AUTOMATION_SECRET ?? '';

    console.log('[verify-code] handler', {
      accountId,
      workerConfigured: Boolean(workerUrl && workerSecret),
    });

    if (!workerUrl || !workerSecret) {
      console.error('[verify-code] AUTOMATION_WORKER_URL or AUTOMATION_SECRET not set');
      return NextResponse.json(
        { ok: false, error: 'Railway worker not configured. Set AUTOMATION_WORKER_URL and AUTOMATION_SECRET in Vercel env vars.' },
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

    console.log('[verify-code] proxying to Railway', {
      url:         `${workerUrl}/telegram/accounts/verify-code`,
      phoneNumber: account.phoneNumber,
    });

    // ── Proxy to Railway ──────────────────────────────────────────────────────
    const workerRes = await fetch(`${workerUrl}/telegram/accounts/verify-code`, {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'x-automation-secret':   workerSecret,
      },
      body: JSON.stringify({
        phoneNumber: account.phoneNumber,
        phoneHash:   otpSession.phoneHash,
        code,
        password:    password ?? '',
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const workerData = await workerRes.json() as {
      ok:            boolean;
      error?:        string;
      requires2fa?:  boolean;
      sessionString?: string;
      telegramId?:   string;
      username?:     string;
      firstName?:    string;
    };

    console.log('[verify-code] Railway response', {
      status:      workerRes.status,
      ok:          workerData.ok,
      requires2fa: workerData.requires2fa ?? false,
      telegramId:  workerData.telegramId ?? null,
    });

    // 2FA required
    if (!workerData.ok && workerData.requires2fa) {
      await upsertTelegramAccount({
        ...account,
        status:       'code_sent',
        errorMessage: '2FA password required',
      }).catch(() => {});
      return NextResponse.json(
        { ok: false, error: '2FA password required', requires2fa: true },
        { status: 422 }
      );
    }

    if (!workerData.ok) {
      const errMsg = workerData.error ?? 'Railway verify-code failed';

      // Map well-known error codes
      let friendlyError = errMsg;
      let status = workerRes.status >= 400 ? workerRes.status : 500;

      if (/PHONE_CODE_INVALID|CODE_INVALID/i.test(errMsg)) {
        friendlyError = 'Invalid verification code';
        status = 400;
      } else if (/PHONE_CODE_EXPIRED|CODE_EXPIRED/i.test(errMsg)) {
        friendlyError = 'Verification code expired — please request a new one';
        status = 400;
      } else if (/FLOOD_WAIT/i.test(errMsg)) {
        const seconds = errMsg.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '60';
        friendlyError = `Too many attempts. Please wait ${seconds} seconds`;
        status = 429;
      } else if (/PASSWORD_HASH_INVALID/i.test(errMsg)) {
        friendlyError = 'Incorrect 2FA password';
        status = 400;
      }

      await upsertTelegramAccount({
        ...account,
        status:       'invalid',
        errorMessage: friendlyError,
      }).catch(() => {});

      return NextResponse.json({ ok: false, error: friendlyError }, { status });
    }

    // Success — persist session and mark account active
    await upsertTelegramAccount({
      ...account,
      status:       'active',
      sessionString: workerData.sessionString ?? '',
      lastActiveAt: new Date().toISOString(),
      errorMessage: undefined,
      ...(workerData.telegramId && { telegramId: workerData.telegramId }),
      ...(workerData.username   && { username:   workerData.username }),
      ...(workerData.firstName  && { displayName: workerData.firstName }),
    });

    console.log('[verify-code] account activated', {
      phoneNumber: account.phoneNumber,
      telegramId:  workerData.telegramId,
      username:    workerData.username,
      handledBy:   'railway',
    });

    return NextResponse.json({
      ok:         true,
      message:    'Account connected',
      telegramId: workerData.telegramId,
      username:   workerData.username,
      firstName:  workerData.firstName,
      handledBy:  'railway',
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[verify-code] proxy error', { message, accountId });

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

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
