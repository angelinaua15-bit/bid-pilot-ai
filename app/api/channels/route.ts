import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramChannelsPaginated,
  getTelegramChannelCount,
  upsertTelegramChannel,
} from '@/lib/db';
import type { ChannelType } from '@/types';

/**
 * GET /api/channels
 * Supports pagination, search and category filtering.
 * ?page=1&pageSize=50&search=...&category=...&status=active
 *
 * Also supports:
 * ?count=1  — returns only { ok, total } (fast HEAD-like query)
 */
export async function GET(req: NextRequest) {
  try {
    const sp       = req.nextUrl.searchParams;
    const countOnly = sp.get('count') === '1';

    if (countOnly) {
      const total = await getTelegramChannelCount({
        status:   sp.get('status')   ?? undefined,
        category: sp.get('category') ?? undefined,
      });
      return NextResponse.json({ ok: true, total });
    }

    const page     = Math.max(1,      Number(sp.get('page'))     || 1);
    // Allow up to 10 000 rows so Unlimited-plan users can load all channels
    // for the campaign picker. Default remains 50 for normal paginated views.
    const pageSize = Math.min(10_000, Number(sp.get('pageSize')) || 50);
    const search   = sp.get('search')   ?? undefined;
    const category = sp.get('category') ?? undefined;
    const status   = sp.get('status')   ?? undefined;

    const { channels, total } = await getTelegramChannelsPaginated({
      page, pageSize, search, category, status,
    });

    return NextResponse.json({
      ok: true,
      channels,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
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
      type:     type     ?? 'channel',
      language: language ?? 'uk',
      category,
      membersCount,
      status:        'active',
      postingMethod: 'bot',
    });

    return NextResponse.json({ ok: true, channel });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  }
}
