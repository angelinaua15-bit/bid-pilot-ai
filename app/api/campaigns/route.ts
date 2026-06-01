import { NextRequest, NextResponse } from 'next/server';
import { getCampaigns, createCampaign, getTelegramChannels } from '@/lib/db';
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
      userId, accountId, title, messageText, targetChannelIds,
      scheduleType, scheduledAt, delayMinSeconds, delayMaxSeconds,
    } = body as {
      userId: string;
      accountId?: string;
      title: string;
      messageText: string;
      targetChannelIds: string[];
      scheduleType?: ScheduleType;
      scheduledAt?: string;
      delayMinSeconds?: number;
      delayMaxSeconds?: number;
    };

    if (!userId || !title || !messageText || !targetChannelIds?.length) {
      return NextResponse.json({ ok: false, error: 'userId, title, messageText and targetChannelIds are required' }, { status: 400 });
    }

    const campaign = await createCampaign({
      userId,
      accountId,
      title,
      messageText,
      targetChannelIds,
      status: 'draft',
      scheduleType: scheduleType ?? 'now',
      scheduledAt,
      delayMinSeconds: delayMinSeconds ?? 3,
      delayMaxSeconds: delayMaxSeconds ?? 10,
    });

    return NextResponse.json({ ok: true, campaign });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
