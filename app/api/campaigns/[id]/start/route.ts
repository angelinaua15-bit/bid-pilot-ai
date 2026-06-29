import { NextRequest, NextResponse } from 'next/server';
import { getCampaignById, getTelegramAccounts, updateCampaignStatus } from '@/lib/db';
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
    if (campaign.status === 'running' || campaign.status === 'joining' || campaign.status === 'sending') {
      return NextResponse.json({ ok: false, error: 'Campaign is already running' }, { status: 409 });
    }

    // Verify there is at least one active Telegram account available for this campaign.
    // Prefer campaign.accountIds, fall back to accountId, then any active account for the user.
    const allUserAccounts = await getTelegramAccounts(campaign.userId);
    const activeAll = allUserAccounts.filter(
      (a) => a.status === 'active' && a.sessionString &&
      (!a.floodWaitUntil || new Date(a.floodWaitUntil) <= new Date())
    );

    let usableAccounts = activeAll;
    if (campaign.accountIds && campaign.accountIds.length > 0) {
      const idSet = new Set(campaign.accountIds);
      const sel = activeAll.filter((a) => idSet.has(a.id));
      if (sel.length > 0) usableAccounts = sel;
    } else if (campaign.accountId) {
      const primary = activeAll.find((a) => a.id === campaign.accountId);
      if (primary) usableAccounts = [primary];
    }

    if (usableAccounts.length === 0) {
      await updateCampaignStatus(id, 'no_accounts');
      return NextResponse.json(
        { ok: false, error: 'Немає активного Telegram-акаунту. Додайте та авторизуйте акаунт у налаштуваннях, або дочекайтесь закінчення FloodWait.' },
        { status: 422 }
      );
    }

    // Mark as joining immediately so the UI reflects state change before the async work begins
    await updateCampaignStatus(id, 'joining');

    // Dispatch in the background — don't await so the HTTP response returns fast.
    // The worker updates the campaign status to 'completed'/'failed'/'partially_completed'/etc. when done.
    dispatchCampaign(id).catch((err) => {
      console.error('[campaign/start] dispatchCampaign error:', err);
    });

    return NextResponse.json({
      ok: true,
      status: 'joining',
      accountCount: usableAccounts.length,
      accountPhones: usableAccounts.map((a) => a.phoneNumber),
    });
  } catch (err) {
    console.error('[campaign/start] error:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
