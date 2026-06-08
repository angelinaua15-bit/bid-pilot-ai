/**
 * POST /api/telegram/accounts/send-code
 *
 * Pure proxy to the Railway worker.
 * No GramJS / TelegramClient runs on Vercel — all MTProto happens on Railway.
 *
 * Body: { accountId, requesterId? }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
} from '@/lib/db';

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body        = await req.json();
    accountId         = (body as { accountId?: string }).accountId;
    const requesterId = (body as { requesterId?: string }).requesterId ?? null;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    // ── Require Railway worker — GramJS never runs on Vercel ─────────────────
    const workerUrl    = process.env.AUTOMATION_WORKER_URL?.replace(/\/$/, '');
    const workerSecret = process.env.AUTOMATION_SECRET ?? '';

    console.log('[send-code] handler', {
      accountId,
      requesterId:       requesterId ?? '(none)',
      workerUrlExists:   Boolean(workerUrl),
      workerUrl:         workerUrl ? workerUrl.replace(/\/\/.+@/, '//***@') : '(not set)',
      automationSecretExists: Boolean(workerSecret),
      authHeaderWillBeSent:   Boolean(workerUrl && workerSecret),
    });

    if (!workerUrl || !workerSecret) {
      console.error('[send-code] AUTOMATION_WORKER_URL or AUTOMATION_SECRET not set — cannot proxy to Railway');
      return NextResponse.json(
        {
          ok:              false,
          error:           'Railway worker not configured. Set AUTOMATION_WORKER_URL and AUTOMATION_SECRET in Vercel env vars.',
          phoneHashExists: false,
        },
        { status: 503 }
      );
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      console.error('[send-code] account not found', { accountId });
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    console.log('[send-code] proxying to Railway', {
      url:         `${workerUrl}/telegram/accounts/send-code`,
      phoneNumber: account.phoneNumber,
    });

    // ── Proxy to Railway ──────────────────────────────────────────────────────
    console.log('[send-code] sending Authorization: Bearer header to Railway', {
      endpoint: `${workerUrl}/telegram/accounts/send-code`,
    });

    const workerRes = await fetch(`${workerUrl}/telegram/accounts/send-code`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        phoneNumber: account.phoneNumber,
        accountId,
      }),
      // 180 s — Railway handles its own GramJS timeout internally
      signal: AbortSignal.timeout(180_000),
    });

    const workerData = await workerRes.json() as {
      ok:             boolean;
      error?:         string;
      telegramError?: string;
      phoneHash?:     string;
      sessionString?: string;
      isCodeViaApp?:  boolean;
      phoneHashExists?: boolean;
    };

    console.log('[send-code] Railway response', {
      status:          workerRes.status,
      ok:              workerData.ok,
      phoneHashExists: !!workerData.phoneHash,
      telegramError:   workerData.telegramError ?? workerData.error ?? null,
    });

    // Railway returned 401 — secret mismatch
    if (workerRes.status === 401) {
      const errMsg = 'Automation secret mismatch between Vercel and Railway. Ensure AUTOMATION_SECRET is the same in both environments.';
      console.error('[send-code] Railway returned 401 — secret mismatch', {
        railwayStatus: workerRes.status,
        workerSecretLength: workerSecret.length,
      });
      return NextResponse.json(
        { ok: false, error: errMsg, telegramError: errMsg, phoneHashExists: false },
        { status: 503 }
      );
    }

    if (!workerData.ok || !workerData.phoneHash) {
      const errMsg = workerData.telegramError ?? workerData.error ?? 'Railway did not return phoneHash';

      // Store error on account row
      await upsertTelegramAccount({
        ...account,
        status:       'invalid',
        errorMessage: errMsg,
      }).catch(() => {});

      return NextResponse.json(
        {
          ok:             false,
          error:          errMsg,
          telegramError:  errMsg,
          phoneHashExists: false,
        },
        { status: workerRes.status >= 400 ? workerRes.status : 500 }
      );
    }

    // Persist OTP session and advance account status
    await Promise.all([
      saveTelegramOtpSession(accountId, workerData.phoneHash, workerData.sessionString ?? ''),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);

    return NextResponse.json({
      ok:             true,
      message:        'Code sent',
      isCodeViaApp:   workerData.isCodeViaApp ?? false,
      phoneHashExists: true,
      handledBy:      'railway',
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-code] proxy error', { message, accountId });

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

    return NextResponse.json(
      {
        ok:             false,
        error:          message,
        telegramError:  message,
        phoneHashExists: false,
      },
      { status: 500 }
    );
  }
}
