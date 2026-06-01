/**
 * POST /api/telegram/accounts/verify-code
 *
 * Delegates the Telegram MTProto signIn call to the worker,
 * receives the session string back, and persists it.
 *
 * Body: { accountId, code, password? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTelegramAccountById, getTelegramOtpSession, upsertTelegramAccount } from '@/lib/db';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId, code, password } = body as {
      accountId?: string;
      code?: string;
      password?: string;
    };

    if (!accountId || !code) {
      return NextResponse.json({ ok: false, error: 'accountId and code are required' }, { status: 400 });
    }

    const [account, otpSession] = await Promise.all([
      getTelegramAccountById(accountId),
      getTelegramOtpSession(accountId),
    ]);

    if (!account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }
    if (!otpSession) {
      return NextResponse.json({ ok: false, error: 'OTP session expired — please request a new code' }, { status: 400 });
    }

    // Forward to worker
    const workerUrl = config.worker.url;
    const workerRes = await fetch(`${workerUrl}/telegram/verify-code`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${process.env.AUTOMATION_SECRET ?? ''}`,
      },
      body: JSON.stringify({
        accountId,
        phoneNumber: account.phoneNumber,
        phoneHash:   otpSession.phoneHash,
        code,
        password,
      }),
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Worker error' }));
      const errMsg = (err as { error?: string }).error ?? 'Verification failed';
      // Mark as invalid if auth fails permanently
      if (/password|2fa|SESSION_PASSWORD_NEEDED/i.test(errMsg)) {
        await upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: '2FA required — provide password' });
        return NextResponse.json({ ok: false, error: errMsg, requires2fa: true }, { status: 422 });
      }
      await upsertTelegramAccount({ ...account, status: 'invalid', errorMessage: errMsg });
      return NextResponse.json({ ok: false, error: errMsg }, { status: 400 });
    }

    const data = await workerRes.json() as { sessionString?: string };
    const sessionString = data.sessionString ?? '';

    // Persist session + mark active
    await upsertTelegramAccount({
      ...account,
      status:        'active',
      sessionString,
      lastActiveAt:  new Date().toISOString(),
      errorMessage:  undefined,
    });

    return NextResponse.json({ ok: true, message: 'Account connected' });
  } catch (err) {
    // Dev mock: accept any code for non-production
    if (process.env.NODE_ENV !== 'production') {
      const body = await req.json().catch(() => ({})) as { accountId?: string };
      if (body.accountId) {
        const account = await getTelegramAccountById(body.accountId);
        if (account) {
          await upsertTelegramAccount({
            ...account,
            status:       'active',
            sessionString: 'mock_session_string_dev',
            lastActiveAt:  new Date().toISOString(),
            errorMessage:  undefined,
          });
          return NextResponse.json({ ok: true, message: 'Account connected (dev mock)' });
        }
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
