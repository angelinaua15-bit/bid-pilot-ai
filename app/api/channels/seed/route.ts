import { NextRequest, NextResponse } from 'next/server';
import { upsertTelegramChannel } from '@/lib/db';
import { UA_EUROPE_CHANNELS, extractUsername } from '@/scripts/seed-channels';

/**
 * POST /api/channels/seed
 * Bulk-inserts ~400 Ukrainian-in-Europe Telegram groups.
 * Safe to call multiple times — existing channels are updated in place.
 */
export async function POST(req: NextRequest) {
  try {
    // Simple admin guard via secret header or query param
    const { searchParams } = new URL(req.url);
    const secret = req.headers.get('x-seed-secret') ?? searchParams.get('secret');
    if (secret !== process.env.SEED_SECRET && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let inserted = 0;

    for (const ch of UA_EUROPE_CHANNELS) {
      const usernameOrLink = extractUsername(ch.link);
      const result = await upsertTelegramChannel({
        title: ch.title,
        usernameOrLink,
        type: 'group',
        category: ch.category,
        language: 'uk',
        status: 'active',
        postingMethod: 'bot',
        notes: [ch.country, ch.city].filter(Boolean).join(', '),
      });
      if (result) inserted++;
    }

    console.log(`[seed] done — inserted/updated ${inserted} of ${UA_EUROPE_CHANNELS.length} channels`);
    return NextResponse.json({ ok: true, total: UA_EUROPE_CHANNELS.length, inserted });
  } catch (err) {
    console.error('[seed] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  }
}
