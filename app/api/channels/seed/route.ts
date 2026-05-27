import { NextRequest, NextResponse } from 'next/server';
import { batchUpsertTelegramChannels, getTelegramChannelCount } from '@/lib/db';
import { assertAdmin } from '@/lib/auth';
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
  peer?: string;          // "Channel" | "Group" | "Megagroup" etc.
  category?: string;
  country?: string;
  language?: string;
  members_count?: number;
}

/** Exact category names from the JSON → short Ukrainian labels */
const CATEGORY_MAP: Record<string, string> = {
  'Бизнес / финансы / инвестиции / крипта':                     'Бізнес / Фінанси / Крипта',
  'Строительство / недвижимость / ремонт / дизайн':              'Нерухомість / Ремонт',
  'Кулинария / еда / рецепты':                                   'Кулінарія / Їжа',
  'Животные / природа / экология':                               'Тварини / Природа',
  'Образование / самообразование / курсы / карьера':             'Освіта / Кар\'єра',
  'Развлечения / юмор / мемы / шоу-бизнес':                     'Розваги / Гумор',
  'Здоровье / спорт / фитнес / психология':                     'Здоров\'я / Спорт',
  'Технологии / IT / ШИ / гаджеты':                             'Технології / IT / AI',
  'Мода / стиль / краса / товары / шоппинг':                    'Мода / Краса / Шопінг',
  'Медиа / новости / блог / личный бренд / lifestyle':           'Медіа / Новини / Lifestyle',
};

function peerToType(peer?: string): 'channel' | 'group' {
  if (!peer) return 'channel';
  const p = peer.toLowerCase();
  if (p.includes('group') || p.includes('mega')) return 'group';
  return 'channel';
}

function parseJsonChannels(): SeedChannel[] {
  try {
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
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({
          title: ch.title.trim(),
          link: ch.link,
          country: ch.country ?? 'Ukraine',
          city: '',
          category: uaCategory,
          // carry peer type through for upsert
          _peer: peerToType(ch.peer),
        } as SeedChannel & { _peer: 'channel' | 'group' });
      }
    }
    console.log(`[seed] parsed ${result.length} unique channels from JSON catalogue`);
    return result;
  } catch (err) {
    console.error('[seed] failed to load channels-catalogue.json:', err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret     = req.headers.get('x-seed-secret') ?? searchParams.get('secret');
    const requesterId = searchParams.get('requesterId') ?? '';
    const isValidSecret = process.env.SEED_SECRET && secret === process.env.SEED_SECRET;
    const admin = requesterId ? await assertAdmin(requesterId) : null;
    if (!isValidSecret && !admin) {
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

    // Build payload array — filter out entries with no usable link
    const payload = all
      .map((ch) => {
        const usernameOrLink = extractUsername(ch.link);
        if (!usernameOrLink) return null;
        const chWithPeer = ch as SeedChannel & { _peer?: 'channel' | 'group' };
        return {
          title:         ch.title,
          usernameOrLink,
          type:          chWithPeer._peer ?? ('group' as const),
          category:      ch.category,
          language:      'uk',
          status:        'active' as const,
          postingMethod: 'bot' as const,
          notes:         [ch.country, ch.city].filter(Boolean).join(', ') || undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Batch upsert in 200-item chunks — orders of magnitude faster than one-by-one
    const { inserted, errors } = await batchUpsertTelegramChannels(payload);
    const totalAfter = await getTelegramChannelCount();

    console.log(`[seed] done — inserted/updated ${inserted}, errors ${errors}, total in DB: ${totalAfter}`);
    return NextResponse.json({
      ok: true,
      total:            payload.length,
      inserted,
      errors,
      totalInDb:        totalAfter,
      europeGroups:     UA_EUROPE_CHANNELS.length,
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
