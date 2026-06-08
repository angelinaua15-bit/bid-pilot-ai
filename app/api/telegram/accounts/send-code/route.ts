/**
 * POST /api/telegram/accounts/send-code
 *
 * Calls GramJS MTProto directly (no worker proxy) to send a login OTP.
 * Saves the phoneHash in telegram_otp_sessions and updates account status.
 *
 * Body: { accountId, requesterId? }
 *   requesterId — optional: SaaSUser.id of the caller (used for owner diagnostics only,
 *                 this route does NOT require auth — any logged-in Telegram user whose
 *                 account row exists may call it).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  upsertTelegramAccount,
  saveTelegramOtpSession,
} from '@/lib/db';
import { sendTelegramCode } from '@/services/telegram-mtproto.service';
import { OWNER_TELEGRAM_ID } from '@/types';

/** Determine if a requesterId string belongs to the hard-coded owner. */
function isOwnerRequester(requesterId?: string | null): boolean {
  if (!requesterId) return false;
  // local_<telegramId> pattern (Supabase not configured or preview mode)
  if (requesterId.startsWith('local_')) {
    return Number(requesterId.slice(6)) === OWNER_TELEGRAM_ID;
  }
  // UUID — will be resolved via account.userId comparison below
  return false;
}

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body        = await req.json();
    accountId         = (body as { accountId?: string }).accountId;
    const requesterId = (body as { requesterId?: string }).requesterId ?? null;

    if (!accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }

    // ── Auth diagnostics (requirements 6-8) ──────────────────────────────────
    const isOwner = isOwnerRequester(requesterId);
    const apiId   = Number(process.env.TELEGRAM_API_ID ?? 0);
    const apiHash = process.env.TELEGRAM_API_HASH ?? '';

    console.log('[send-code] auth check', {
      accountId,
      requesterId:       requesterId ?? '(not provided)',
      isOwner,
      apiIdSet:          Boolean(apiId),
      apiHashLen:        apiHash.length,
      workerConfigured:  Boolean(process.env.AUTOMATION_WORKER_URL),
    });

    // Validate env vars up front — give a clear error instead of a cryptic GramJS crash
    if (!apiId || !apiHash) {
      console.error('[send-code] TELEGRAM_API_ID or TELEGRAM_API_HASH not set');
      return NextResponse.json(
        { ok: false, error: 'Telegram API credentials not configured on server' },
        { status: 503 }
      );
    }

    const account = await getTelegramAccountById(accountId);
    if (!account) {
      console.error('[send-code] account not found', { accountId, isOwner });
      return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 });
    }

    console.log('[send-code] account found', {
      phoneNumber: account.phoneNumber,
      status:      account.status,
      userId:      account.userId,
      isOwner,
    });

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
      friendlyError = 'Invalid Telegram API credentials (API_ID_INVALID)';
      status = 503;
    } else if (/^Unauthorized$|401.*Unauthorized|Unauthorized.*401/i.test(message) || message === 'Unauthorized') {
      // Telegram sends 401 UNAUTHORIZED when api_id is blocked on this IP/environment
      // or when the auth key is corrupted. This is NOT a user auth issue.
      friendlyError =
        'Telegram rejected the API credentials with 401 Unauthorized. ' +
        'Possible causes: (1) api_id is banned on cloud IPs — try a new api_id from my.telegram.org, ' +
        '(2) the auth key is corrupted — restart the server, ' +
        '(3) the api_hash does not match the api_id.';
      status = 503;
      console.error('[send-code] Telegram 401 UNAUTHORIZED — api_id may be blocked on this server IP', {
        apiId: process.env.TELEGRAM_API_ID,
        apiHashLength: process.env.TELEGRAM_API_HASH?.length,
      });
    } else if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|timed out/i.test(message)) {
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
