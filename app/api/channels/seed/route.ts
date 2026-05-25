import { NextRequest, NextResponse } from 'next/server';
import { upsertTelegramChannel } from '@/lib/db';
import { UA_EUROPE_CHANNELS, extractUsername, type SeedChannel } from '@/scripts/seed-channels';

/**
 * POST /api/channels/seed
 * Seeds all channels:
 *   1. ~240 Ukrainian-in-Europe groups + digital communities (from seed-channels.ts)
 *   2. 2366 Ukrainian Telegram channels from the categorized JSON catalogue
 * Safe to call multiple times — upsert on username_or_link.
 */

interface JsonChannel {
  title: string;
  link?: string;
  peer?: string;
  category?: string;
  country?: string;
  language?: string;
}

/** Map JSON category names to shorter Ukrainian labels */
const CATEGORY_MAP: Record<string, string> = {
  'Бизнес / финансы / инвестиции / крипта': 'Бізнес / Фінанси',
  'Новости / политика': 'Новини / Політика',
  'Развлечения / юмор': 'Розваги / Гумор',
  'Технологии / IT': 'Діджитал / IT',
  'Образование / наука': 'Освіта / Наука',
  'Здоровье / красота': 'Б\'юті / Послуги',
  'Спорт': 'Спорт',
  'Путешествия': 'Подорожі',
  'Кулинария': 'Кулінарія',
  'Другое': 'Різне',
};

function parseJsonChannels(): SeedChannel[] {
  try {
    // Import JSON at runtime — Next.js supports JSON imports natively
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('@/data/channels-catalogue.json') as {
      categories: Record<string, { channels: { channels: JsonChannel[] } }>;
    };

    const result: SeedChannel[] = [];
    const seen = new Set<string>();

    for (const [catName, catData] of Object.entries(raw.categories)) {
      const uaCategory = CATEGORY_MAP[catName] ?? catName;
      const channels: JsonChannel[] = catData?.channels?.channels ?? [];
      for (const ch of channels) {
        if (!ch.link || !ch.title) continue;
        const key = extractUsername(ch.link).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          title: ch.title,
          link: ch.link,
          country: ch.country ?? 'Ukraine',
          city: '',
          category: uaCategory,
        });
      }
    }
    return result;
  } catch {
    console.error('[seed] failed to load channels-catalogue.json');
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = req.headers.get('x-seed-secret') ?? searchParams.get('secret');
    if (secret !== process.env.SEED_SECRET && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Merge both sources, deduplicate by username/link
    const jsonChannels = parseJsonChannels();
    const allSeedKeys = new Set(UA_EUROPE_CHANNELS.map((c) => extractUsername(c.link).toLowerCase()));
    const uniqueJsonChannels = jsonChannels.filter(
      (c) => !allSeedKeys.has(extractUsername(c.link).toLowerCase()),
    );
    const all: SeedChannel[] = [...UA_EUROPE_CHANNELS, ...uniqueJsonChannels];

    console.log(`[seed] starting — ${UA_EUROPE_CHANNELS.length} Europe groups + ${uniqueJsonChannels.length} JSON channels = ${all.length} total`);

    let inserted = 0;
    for (const ch of all) {
      const usernameOrLink = extractUsername(ch.link);
      const result = await upsertTelegramChannel({
        title: ch.title,
        usernameOrLink,
        type: (ch as SeedChannel & { peer?: string }).peer?.toLowerCase() === 'channel' ? 'channel' : 'group',
        category: ch.category,
        language: 'uk',
        status: 'active',
        postingMethod: 'bot',
        notes: [ch.country, ch.city].filter(Boolean).join(', '),
      });
      if (result) inserted++;
    }

    console.log(`[seed] done — inserted/updated ${inserted} of ${all.length}`);
    return NextResponse.json({
      ok: true,
      total: all.length,
      inserted,
      europeGroups: UA_EUROPE_CHANNELS.length,
      catalogueChannels: uniqueJsonChannels.length,
    });
  } catch (err) {
    console.error('[seed] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  }
}
