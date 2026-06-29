import { NextRequest, NextResponse } from 'next/server';
import { getTelegramAccounts } from '@/lib/db';

/**
 * GET /api/telegram/accounts/active?userId=...
 *
 * Returns only the `active` Telegram accounts for a specific user.
 * This endpoint is intentionally NOT admin-guarded — any authenticated
 * user can fetch their own active accounts (needed by the campaign form).
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: 'userId is required', accounts: [] },
        { status: 400 },
      );
    }

    const all = await getTelegramAccounts(userId);
    const active = all.filter((a) => a.status === 'active');

    return NextResponse.json({ ok: true, accounts: active });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[accounts/active] error:', message);
    return NextResponse.json(
      { ok: false, error: message, accounts: [] },
      { status: 500 },
    );
  }
}
