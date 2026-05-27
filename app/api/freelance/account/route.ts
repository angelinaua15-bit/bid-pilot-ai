import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, upsertFreelanceAccount } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const account = await getFreelanceAccount(userId);

    // If row exists but has no token, treat it as disconnected and patch DB
    if (account && account.status === 'connected' && !account.apiToken) {
      const fixed = await upsertFreelanceAccount({
        userId,
        status: 'disconnected',
        accountName: undefined,
      });
      return NextResponse.json({ ok: true, account: fixed });
    }

    return NextResponse.json({ ok: true, account });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
