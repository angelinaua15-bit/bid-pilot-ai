import { NextRequest, NextResponse } from 'next/server';
import { getCampaignById, getTelegramAccountById, getTelegramAccounts, updateCampaignStatus } from '@/lib/db';
import { dispatchCampaign } from '@/services/campaign-dispatch.service';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const campaign = await getCampaignById(id);
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 });
    }
    if (campaign.status === 'running') {
      return NextResponse.json({ ok: false, error: 'Campaign is already running' }, { status: 409 });
    }

    // Verify there is at least one active Telegram account available
    let account = campaign.accountId ? await getTelegramAccountById(campaign.accountId) : null;
    if (!account || account.status !== 'active' || !account.sessionString) {
      const all = await getTelegramAccounts(campaign.userId);
      account = all.find((a) => a.status === 'active' && a.sessionString) ?? null;
    }
    if (!account) {
      return NextResponse.json(
        { ok: false, error: 'Немає активного Telegram-акаунту. Додайте та авторизуйте акаунт у налаштуваннях.' },
        { status: 422 }
      );
    }

    // Mark running immediately so the UI reflects state change
    await updateCampaignStatus(id, 'running');

    // Dispatch in the background — don't await so the HTTP response returns fast.
    // The worker updates the campaign status to 'completed'/'failed' when done.
    dispatchCampaign(id).catch((err) => {
      console.error('[campaign/start] dispatchCampaign error:', err);
    });

    return NextResponse.json({ ok: true, status: 'running', accountPhone: account.phoneNumber });
  } catch (err) {
    console.error('[campaign/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
