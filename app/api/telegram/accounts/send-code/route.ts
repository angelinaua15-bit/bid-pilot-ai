/**
 * POST /api/telegram/accounts/send-code
 *
 * Calls GramJS MTProto directly (no worker proxy) to send a login OTP.
 * Saves the phoneHash in telegram_otp_sessions and updates account status.
 *
 * Body: { accountId }
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
    const body = await req.json();
    accountId = (body as { accountId?: string }).accountId;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    // Validate env vars up front — give a clear error instead of a cryptic GramJS crash
    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';
    if (!apiId || !apiHash) {
      console.error('[send-code] TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server' },
        { status: 503 }
      );
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    // ── Route to Railway worker if configured (avoids Vercel 10s timeout) ──────
    const workerUrl  = process.env.AUTOMATION_WORKER_URL?.replace(/\/$/, '');
    const workerSecret = process.env.AUTOMATION_SECRET ?? '';
    const viaWorker  = Boolean(workerUrl && workerSecret);

    console.log(`[send-code] routing via ${viaWorker ? 'Railway worker: ' + workerUrl : 'Vercel direct GramJS'} for ${account.phoneNumber}`);

    let phoneHash: string;
    let isCodeViaApp: boolean;
    let sessionString: string;

    if (viaWorker) {
      // ── Worker path: POST {workerUrl}/telegram/send-code ─────────────────────
      const workerRes = await fetch(`${workerUrl}/telegram/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-automation-secret': workerSecret,
        },
        body: JSON.stringify({
          phoneNumber: account.phoneNumber,
          accountId,
        }),
        // 180s signal — worker handles its own internal 60s*3 retry
        signal: AbortSignal.timeout(180_000),
      });

      const workerData = await workerRes.json() as {
        ok: boolean; error?: string;
        phoneHash?: string; sessionString?: string; isCodeViaApp?: boolean;
      };
      console.log('[send-code] worker response', { status: workerRes.status, ok: workerData.ok, phoneHashExists: !!workerData.phoneHash });

      if (!workerData.ok || !workerData.phoneHash) {
        const errMsg = workerData.error ?? 'Worker did not return phoneHash';
        throw new Error(errMsg);
      }

      phoneHash     = workerData.phoneHash;
      isCodeViaApp  = workerData.isCodeViaApp ?? false;
      sessionString = workerData.sessionString ?? '';

    } else {
      // ── Direct path: GramJS runs inside Vercel function ──────────────────────
      let result: Awaited<ReturnType<typeof sendTelegramCode>> | null = null;
      try {
        result = await sendTelegramCode(account.phoneNumber);
        console.log('[send-code] result', {
          phoneNumber:      account.phoneNumber,
          phoneHashExists:  !!result.phoneHash,
          phoneHashPrefix:  result.phoneHash?.slice(0, 8),
          isCodeViaApp:     result.isCodeViaApp,
          sessionStrLength: result.sessionString?.length ?? 0,
        });
      } catch (sendErr) {
        console.error('[send-code] error', sendErr instanceof Error ? sendErr.message : sendErr);
        throw sendErr;
      }

      phoneHash     = result.phoneHash;
      isCodeViaApp  = result.isCodeViaApp;
      sessionString = result.sessionString;
    }

    // Guard: if no phoneCodeHash, Telegram never confirmed the send — do NOT say "code sent"
    if (!phoneHash) {
      console.error('[send-code] phoneCodeHash is empty — GramJS returned no hash');
      return NextResponse.json(
        { ok: false, error: 'Telegram did not return a phoneCodeHash. Code was NOT sent.', phoneHashExists: false },
        { status: 500 }
      );
    }

    // Persist OTP session (including DC session string) and update account status
    await Promise.all([
      saveTelegramOtpSession(accountId, phoneHash, sessionString),
      upsertTelegramAccount({ ...account, status: 'code_sent', errorMessage: undefined }),
    ]);

    return NextResponse.json({
      ok:            true,
      message:       'Code sent',
      isCodeViaApp,
      phoneHashExists: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? err.stack?.split('\n').slice(0, 4).join(' | ') : '';
    console.error('[send-code] error', { message, stack, accountId });

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
      friendlyError = 'Invalid Telegram API credentials';
      status = 503;
    } else if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
      friendlyError = 'Cannot reach Telegram servers. Check network connection';
      status = 503;
    }

    // Update account with error state if we resolved the accountId
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

    return NextResponse.json({
      ok:            false,
      error:         friendlyError,
      telegramError: message,     // exact raw Telegram/GramJS error for debugging
      phoneHashExists: false,
    }, { status });
  }
}
