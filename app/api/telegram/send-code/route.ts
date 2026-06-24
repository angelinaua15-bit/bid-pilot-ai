/**
 * POST /api/telegram/send-code
 * Body: { accountId?, phoneNumber?, userId? }
 *
 * Used by the Telegram Mini App. Resolves or creates the account row,
 * then delegates to the shared handleSendCode handler.
 * ok:true is returned ONLY when Telegram confirms a real phoneCodeHash.
 */
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccountById,
  getTelegramAccounts,
  upsertTelegramAccount,
} from '@/lib/db';
import { handleSendCode } from '@/lib/telegram/send-code-handler';

function cleanPhone(phone?: string) {
  return phone?.trim().replace(/\s+/g, '') ?? '';
}

export async function POST(req: NextRequest) {
  let accountId: string | undefined;

  try {
    const body = await req.json() as { accountId?: string; phoneNumber?: string; userId?: string };
    accountId = body.accountId;
    const phoneNumber = cleanPhone(body.phoneNumber);
    const userId = body.userId;

    // ── Resolve or create the account row ─────────────────────────────────
    if (!accountId && phoneNumber) {
      if (!userId) {
        return NextResponse.json(
          { ok: false, error: 'userId is required when using phoneNumber', phoneHashExists: false },
          { status: 400 }
        );
      }

      const accounts = await getTelegramAccounts(userId);
      const found = accounts.find(
        (item) => cleanPhone(item.phoneNumber) === phoneNumber
      );

      if (found) {
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
            { ok: false, error: 'Failed to create Telegram account', phoneHashExists: false },
            { status: 500 }
          );
        }

        accountId = created.id;
      }
    }

    if (accountId) {
      // Verify it exists (may be passed directly from client)
      const check = await getTelegramAccountById(accountId);
      if (!check) {
        return NextResponse.json(
          { ok: false, error: 'Account not found', phoneHashExists: false },
          { status: 404 }
        );
      }
    }

    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: 'accountId or phoneNumber+userId is required', phoneHashExists: false },
        { status: 400 }
      );
    }

    return handleSendCode({ accountId, requesterId: userId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[telegram/send-code] unhandled error:', message);
    return NextResponse.json(
      { ok: false, error: message, phoneHashExists: false, handledBy: 'vercel' },
      { status: 500 }
    );
  }
}
