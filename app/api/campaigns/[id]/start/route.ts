import { NextRequest, NextResponse } from 'next/server';
import { getCampaignById, getTelegramAccounts, updateCampaignStatus } from '@/lib/db';
import { dispatchCampaign } from '@/services/campaign-dispatch.service';

/**
 * maxDuration = 300 seconds (5 minutes).
 * Without this, Vercel kills the function after the HTTP response is sent,
 * which terminates fire-and-forget background dispatch before it completes.
 * With this we await the full dispatch before responding.
 */
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = new Date().toISOString();

  try {
    const { id } = await params;

    const campaign = await getCampaignById(id);
    if (!campaign) {
      return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
    }

    // Prevent double-start
    if (campaign.status === 'running' || campaign.status === 'joining' || campaign.status === 'sending') {
      return NextResponse.json(
        { ok: false, error: `Кампанія вже виконується (статус: ${campaign.status})` },
        { status: 409 }
      );
    }

    // Pre-flight: verify at least one usable account exists
    const allUserAccounts = await getTelegramAccounts(campaign.userId);
    const activeAll = allUserAccounts.filter(
      (a) => a.status === 'active' &&
             (!a.floodWaitUntil || new Date(a.floodWaitUntil) <= new Date())
    );

    let usableAccounts = activeAll;
    if (campaign.accountIds && campaign.accountIds.length > 0) {
      const idSet = new Set(campaign.accountIds);
      const sel   = activeAll.filter((a) => idSet.has(a.id));
      if (sel.length > 0) usableAccounts = sel;
    } else if (campaign.accountId) {
      const primary = activeAll.find((a) => a.id === campaign.accountId);
      if (primary) usableAccounts = [primary];
    }

    if (usableAccounts.length === 0) {
      await updateCampaignStatus(id, 'no_accounts');
      return NextResponse.json(
        {
          ok: false,
          error: 'Немає активного Telegram-акаунту. Додайте та авторизуйте акаунт у налаштуваннях.',
          status: 'no_accounts',
        },
        { status: 422 }
      );
    }

    if (!campaign.targetChannelIds || campaign.targetChannelIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Кампанія не містить каналів для розсилки. Додайте канали перед запуском.' },
        { status: 422 }
      );
    }

    // Set status to 'joining' immediately so UI reflects the state change
    await updateCampaignStatus(id, 'joining');

    // Await the full dispatch — maxDuration=300 keeps the function alive
    const result = await dispatchCampaign(id);

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt:   new Date().toISOString(),
      accountCount: usableAccounts.length,
      accountPhones: usableAccounts.map((a) => a.phoneNumber),
      ...result,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[campaign/start] error:', message);
    return NextResponse.json(
      { ok: false, error: message, startedAt },
      { status: 500 }
    );
  }
}
