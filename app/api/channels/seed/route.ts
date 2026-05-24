import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { UA_EUROPE_CHANNELS, extractUsername } from '@/scripts/seed-channels';

/**
 * POST /api/channels/seed
 * Bulk-inserts ~400 Ukrainian-in-Europe Telegram groups.
 * Uses ON CONFLICT (username_or_link) DO UPDATE so it's safe to call multiple times.
 */
export async function POST(req: NextRequest) {
  try {
    // Simple admin guard via secret header or query param
    const { searchParams } = new URL(req.url);
    const secret = req.headers.get('x-seed-secret') ?? searchParams.get('secret');
    if (secret !== process.env.SEED_SECRET && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();
    if (!db) return NextResponse.json({ ok: false, error: 'DB not configured' }, { status: 500 });

    const now = new Date().toISOString();

    const rows = UA_EUROPE_CHANNELS.map((ch) => ({
      title: ch.title,
      username_or_link: extractUsername(ch.link),
      type: 'group' as const,
      category: ch.category,
      language: 'uk',
      status: 'active',
      posting_method: 'bot',
      notes: [ch.country, ch.city].filter(Boolean).join(', '),
      created_at: now,
      updated_at: now,
    }));

    // Upsert in batches of 100 to avoid request size limits
    const BATCH = 100;
    let inserted = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { data, error } = await db
        .from('telegram_channels')
        .upsert(batch, { onConflict: 'username_or_link', ignoreDuplicates: false })
        .select('id');

      if (error) {
        console.error('[seed] batch error:', error);
        // Try inserting one by one to skip duplicates that fail
        for (const row of batch) {
          const { error: singleErr } = await db
            .from('telegram_channels')
            .insert(row)
            .select('id');
          if (!singleErr) inserted++;
        }
      } else {
        inserted += data?.length ?? 0;
      }
    }

    console.log(`[seed] done — inserted/updated ${inserted} channels from ${rows.length} total`);
    return NextResponse.json({ ok: true, total: rows.length, inserted });
  } catch (err) {
    console.error('[seed] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  }
}
