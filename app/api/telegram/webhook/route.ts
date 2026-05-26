/**
 * POST /api/telegram/webhook
 * Telegram Bot webhook — primary handler registered with BotFather.
 *
 * Register this URL via:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=<NEXT_PUBLIC_APP_URL>/api/telegram/webhook
 */

import { NextRequest, NextResponse } from 'next/server';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

// ── Bot API helper ────────────────────────────────────────────────────────────

async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not set');
    return;
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    console.error('[telegram/webhook] sendMessage error:', err);
  }
}

// ── Command: /start ───────────────────────────────────────────────────────────

async function handleStart(chatId: number): Promise<void> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  const text = [
    'Привіт! 👋',
    'Це BidPilot AI.',
    '',
    'Натисни кнопку нижче 👇',
  ].join('\n');

  const replyMarkup = appUrl
    ? {
        inline_keyboard: [
          [
            {
              text: '🚀 Відкрити додаток',
              web_app: { url: appUrl },
            },
          ],
        ],
      }
    : undefined;

  await sendMessage(chatId, text, replyMarkup);
}

// ── Update processor ──────────────────────────────────────────────────────────

async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (!update.message) return;

  const { chat, text } = update.message;
  if (!text) return;

  const command = text.trim().split(/\s+/)[0].toLowerCase();

  if (command === '/start') {
    await handleStart(chat.id);
  }
  // Other commands (/help, /app, /status) are handled by /api/webhook/route.ts
  // Both routes can be used — /api/telegram/webhook is the canonical BotFather URL.
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const incoming = req.headers.get('x-telegram-bot-api-secret-token') ?? '';

  if (secret && incoming !== secret) {
    console.warn('[telegram/webhook] Invalid secret token');
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    await processUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram/webhook] Error:', err);
    // Always return 200 — Telegram retries on non-2xx
    return NextResponse.json({ ok: false, error: 'Internal error' });
  }
}

// GET — health check (Telegram only sends POST, but useful for verification)
export async function GET(): Promise<NextResponse> {
  const tokenSet = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  return NextResponse.json({
    ok: true,
    service: 'BidPilot AI — Telegram Webhook',
    status: 'running',
    tokenConfigured: tokenSet,
    appUrl,
  });
}
