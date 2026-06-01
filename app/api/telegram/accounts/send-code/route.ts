/**
 * POST /api/telegram/accounts/send-code
 *
 * Delegates the actual Telegram MTProto sendCode call to the worker
 * (which runs GramJS in Node.js). The Next.js API route acts as a proxy
 * that also updates the account status in the DB.
 *
 * Body: { accountId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getTelegramAccountById, upsertTelegramAccount, saveTelegramOtpSession } from '@/lib/db';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId } = body as { accountId?: string };
    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    // Forward to worker which handles GramJS MTProto
    const workerUrl = config.worker.url;
    const workerRes = await fetch(`${workerUrl}/telegram/send-code`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${process.env.AUTOMATION_SECRET ?? ''}`,
      },
      body: JSON.stringify({ accountId, phoneNumber: account.phoneNumber }),
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Worker error' }));
      // Update account with error
      await upsertTelegramAccount({ ...account, status: 'invalid', errorMessage: (err as { error?: string }).error });
      return NextResponse.json({ ok: false, error: (err as { error?: string }).error ?? 'Worker error' }, { status: 502 });
    }

    const data = await workerRes.json() as { phoneHash?: string };
    const phoneHash = data.phoneHash ?? 'mock_phone_hash';

    // Save OTP session
    await saveTelegramOtpSession(accountId, phoneHash);
    // Update account status
    await upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined });

    return NextResponse.json({ ok: true, message: 'Code sent' });
  } catch (err) {
    // Worker might not be running locally — fall back to mock flow for dev
    if (process.env.NODE_ENV !== 'production') {
      const { accountId } = await req.json().catch(() => ({})) as { accountId?: string };
      if (accountId) {
        const account = await getTelegramAccountById(accountId);
        if (account) {
          await saveTelegramOtpSession(accountId, 'mock_phone_hash_dev');
          await upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined });
          return NextResponse.json({ ok: true, message: 'Code sent (dev mock)' });
        }
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
