/**
 * POST /api/webhook
 * Telegram Bot webhook handler.
 *
 * Telegram sends all bot updates (messages, callback queries, etc.) here.
 * The secret_token header is checked against TELEGRAM_WEBHOOK_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/services/telegram.service';

// ── Types ────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

// ── App URL helper ────────────────────────────────────────────────────────────

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleStart(chatId: number, firstName: string): Promise<void> {
  const appUrl = getAppUrl();

  const text = [
    `Привіт, <b>${firstName}</b>! 👋`,
    '',
    '<b>BidPilot AI</b> — твій AI-помічник для фрілансу на Freelancehunt.',
    '',
    'Що я вмію:',
    '• Моніторинг нових проєктів',
    '• Генерація персоналізованих заявок через AI',
    '• Авто-розрахунок ціни і термінів',
    '• Аналітика твоїх відгуків',
    '',
    'Натисни кнопку нижче, щоб відкрити додаток:',
  ].join('\n');

  await sendTelegramMessage(chatId, text, {
    parseMode: 'HTML',
    replyMarkup: appUrl
      ? {
          inline_keyboard: [
            [{ text: 'Відкрити BidPilot AI', web_app: { url: appUrl } }],
          ],
        }
      : undefined,
  });
}

async function handleHelp(chatId: number): Promise<void> {
  const text = [
    '<b>Доступні команди:</b>',
    '',
    '/start — запустити бота / відкрити додаток',
    '/help — показати цю довідку',
    '/status — перевірити статус підписки',
    '/app — відкрити Mini App',
    '',
    'З питань та підтримки пишіть у @bidpilot_support',
  ].join('\n');

  await sendTelegramMessage(chatId, text, { parseMode: 'HTML' });
}

async function handleApp(chatId: number): Promise<void> {
  const appUrl = getAppUrl();
  if (!appUrl) {
    await sendTelegramMessage(chatId, 'Додаток ще не налаштований. Спробуйте пізніше.');
    return;
  }

  await sendTelegramMessage(chatId, 'Відкрийте BidPilot AI:', {
    parseMode: 'HTML',
    replyMarkup: {
      inline_keyboard: [
        [{ text: 'Відкрити BidPilot AI', web_app: { url: appUrl } }],
      ],
    },
  });
}

async function handleStatus(chatId: number): Promise<void> {
  // TODO: fetch real subscription from DB:
  // const user = await prisma.user.findUnique({ where: { telegramId: chatId } });
  const text = [
    '<b>Ваш статус:</b>',
    '',
    'Тарифний план: <b>Старт (безкоштовний)</b>',
    'Залишок генерацій: <b>3 / 5</b>',
    '',
    'Оновіть план для необмежених заявок.',
  ].join('\n');

  await sendTelegramMessage(chatId, text, { parseMode: 'HTML' });
}

async function handleUnknown(chatId: number): Promise<void> {
  await sendTelegramMessage(
    chatId,
    'Я не розумію цю команду. Введіть /help для списку доступних команд.'
  );
}

// ── Update processor ──────────────────────────────────────────────────────────

async function processUpdate(update: TelegramUpdate): Promise<void> {
  // Handle regular messages / commands
  if (update.message) {
    const { chat, from, text } = update.message;
    const chatId = chat.id;
    const firstName = from.first_name ?? 'User';

    if (!text) return;

    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/start':
        await handleStart(chatId, firstName);
        break;
      case '/help':
        await handleHelp(chatId);
        break;
      case '/app':
        await handleApp(chatId);
        break;
      case '/status':
        await handleStatus(chatId);
        break;
      default:
        // Ignore non-command messages (user typed something in bot chat)
        if (command.startsWith('/')) {
          await handleUnknown(chatId);
        }
    }
    return;
  }

  // Handle inline button presses
  if (update.callback_query) {
    const { from, data, message } = update.callback_query;
    const chatId = message?.chat.id ?? from.id;
    console.log('[webhook] callback_query:', { from: from.id, data });

    // TODO: handle callback_query data (e.g. plan selection, bid actions)
    await sendTelegramMessage(chatId, `Дія: ${data ?? 'unknown'}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Verify the request comes from Telegram using the secret token
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const incoming = req.headers.get('x-telegram-bot-api-secret-token') ?? '';

  if (secret && incoming !== secret) {
    console.warn('[webhook] Invalid secret token');
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    console.log('[webhook] update_id:', update.update_id);
    await processUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[webhook] Error processing update:', err);
    // Always return 200 to Telegram (otherwise it retries forever)
    return NextResponse.json({ ok: false, error: 'Internal error' });
  }
}

// Telegram only sends POST, but expose GET for health-check in browser
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: 'BidPilot AI Webhook', status: 'running' });
}
