import { NextRequest, NextResponse } from 'next/server';
import { getTelegramChannels, upsertTelegramChannel } from '@/lib/db';
import type { ChannelType } from '@/types';

export async function GET(_req: NextRequest) {
  try {
    const channels = await getTelegramChannels();
    return NextResponse.json({ ok: true, channels, data: channels });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, usernameOrLink, type, language, category, membersCount } = body as {
      title: string;
      usernameOrLink: string;
      type?: ChannelType;
      language?: string;
      category?: string;
      membersCount?: number;
    };

    if (!title || !usernameOrLink) {
      return NextResponse.json({ ok: false, error: 'title and usernameOrLink required' }, { status: 400 });
    }

    const channel = await upsertTelegramChannel({
      title,
      usernameOrLink,
      type: type ?? 'channel',
      language: language ?? 'uk',
      category,
      membersCount,
      status: 'active',
      postingMethod: 'bot',
    });

    return NextResponse.json({ ok: true, channel });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
