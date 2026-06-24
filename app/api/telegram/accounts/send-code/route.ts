/**
 * POST /api/telegram/accounts/send-code
 * Body: { accountId: string, requesterId?: string }
 *
 * Delegates entirely to the shared handleSendCode handler.
 * ok:true is returned ONLY when Telegram confirms a real phoneCodeHash.
 */
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { handleSendCode } from '@/lib/telegram/send-code-handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { accountId?: string; requesterId?: string };
    const { accountId, requesterId } = body;

    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: 'accountId is required', phoneHashExists: false },
        { status: 400 }
      );
    }

    return handleSendCode({ accountId, requesterId: requesterId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[accounts/send-code] unhandled error:', message);
    return NextResponse.json(
      { ok: false, error: message, phoneHashExists: false, handledBy: 'vercel' },
      { status: 500 }
    );
  }
}
