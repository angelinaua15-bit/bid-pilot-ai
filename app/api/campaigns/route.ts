import { NextRequest, NextResponse } from 'next/server';
import { getCampaigns, createCampaign, getTelegramAccounts } from '@/lib/db';
import { config } from '@/lib/config';
import { computeDailySendTime } from '@/services/telegram-daily-schedule.service';
import type { ScheduleType } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const campaigns = await getCampaigns(userId);
    return NextResponse.json({ ok: true, campaigns, data: campaigns });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId, accountId, accountIds, title, messageText, targetChannelIds,
      scheduleType, scheduledAt, delayMinSeconds, delayMaxSeconds,
    } = body as {
      userId: string;
      accountId?: string;
      accountIds?: string[];
      title: string;
      messageText: string;
      targetChannelIds: string[];
      scheduleType?: ScheduleType | 'daily';
      scheduledAt?: string;
      delayMinSeconds?: number;
      delayMaxSeconds?: number;
    };

    if (!userId || !title || !messageText || !targetChannelIds?.length) {
      return NextResponse.json({ ok: false, error: 'userId, title, messageText and targetChannelIds are required' }, { status: 400 });
    }

    // For daily campaigns: compute a randomised send time within 08:00-22:00 Kyiv
    let resolvedScheduledAt = scheduledAt;
    let resolvedStatus: 'draft' | 'scheduled' = 'draft';
    const resolvedScheduleType = scheduleType ?? 'now';

    if (resolvedScheduleType === 'daily') {
      // Get the user's active Telegram accounts to assign different slots
      const userAccounts = await getTelegramAccounts(userId).catch(() => []);
      const activeAccounts = userAccounts.filter((a) => a.status === 'active');
      const totalAccounts = Math.max(1, activeAccounts.length);

      // Find index of the selected account (or use 0)
      const accountIndex = accountId
        ? Math.max(0, activeAccounts.findIndex((a) => a.id === accountId))
        : 0;

      const sendTime = computeDailySendTime(accountIndex, totalAccounts, accountId ?? userId);
      resolvedScheduledAt = sendTime.toISOString();
      resolvedStatus = 'scheduled';
    } else if (resolvedScheduleType === 'scheduled' && scheduledAt) {
      resolvedStatus = 'scheduled';
    }

    const campaign = await createCampaign({
      userId,
      accountId,
      accountIds: accountIds && accountIds.length > 0 ? accountIds : undefined,
      title,
      messageText,
      targetChannelIds,
      status: resolvedStatus,
      scheduleType: resolvedScheduleType as ScheduleType,
      scheduledAt: resolvedScheduledAt,
      delayMinSeconds: delayMinSeconds ?? 3,
      delayMaxSeconds: delayMaxSeconds ?? 10,
    });

    // If scheduleType is 'now', immediately trigger dispatch via worker
    if (campaign && (resolvedScheduleType === 'now')) {
      const workerUrl = config.worker.url;
      const secret    = process.env.AUTOMATION_SECRET ?? '';
      if (workerUrl && secret) {
        fetch(`${workerUrl}/campaigns/dispatch`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body:    JSON.stringify({ campaignId: campaign.id }),
        }).catch(() => { /* fire and forget */ });
      }
    }

    return NextResponse.json({ ok: true, campaign });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
