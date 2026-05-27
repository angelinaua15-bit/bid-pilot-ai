/**
 * services/telegram.service.ts
 * Server-side Telegram Bot API integration.
 *
 * TODO: Use real TELEGRAM_BOT_TOKEN.
 */

import type { TelegramUser } from '@/types';
import crypto from 'crypto';

/**
 * Validate initData from Telegram WebApp.
 * Call this in your auth API route to verify the user is from Telegram.
 */
export function validateTelegramInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return hash === expectedHash;
}

/**
 * Parse user from Telegram initData.
 */
export function parseTelegramUser(initData: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(decodeURIComponent(userStr)) as TelegramUser;
  } catch {
    return null;
  }
}

const TELEGRAM_API = (token: string) =>
  `https://api.telegram.org/bot${token}`;

/**
 * Send a message via Telegram Bot API.
 */
const TELEGRAM_SEND_TIMEOUT_MS = 8_000;

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'MarkdownV2';
    replyMarkup?: Record<string, unknown>;
    disableWebPagePreview?: boolean;
  }
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[TelegramService] TELEGRAM_BOT_TOKEN not set');
    return false;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parseMode ?? 'HTML',
          disable_web_page_preview: options?.disableWebPagePreview ?? false,
          ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    const json = await res.json();
    if (!json.ok) {
      console.error('[TelegramService] sendMessage error:', json);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      console.warn(`[TelegramService] sendMessage timed out after ${TELEGRAM_SEND_TIMEOUT_MS}ms`);
    } else {
      console.error('[TelegramService] sendMessage exception:', err);
    }
    return false;
  }
}

/** Backward-compatible alias */
export async function sendTelegramNotification(
  chatId: number,
  text: string,
  options?: { parseMode?: 'HTML' | 'Markdown' }
): Promise<void> {
  await sendTelegramMessage(chatId, text, { parseMode: options?.parseMode as 'HTML' });
}

/**
 * Register a webhook URL with Telegram.
 */
export async function setWebhook(webhookUrl: string): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const res = await fetch(`${TELEGRAM_API(token)}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'inline_query'],
      drop_pending_updates: true,
    }),
  });
  return res.json();
}

/**
 * Get current webhook info from Telegram.
 */
export async function getWebhookInfo(): Promise<Record<string, unknown>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  const res = await fetch(`${TELEGRAM_API(token)}/getWebhookInfo`);
  return res.json();
}

/**
 * Get bot info (getMe).
 */
export async function getBotInfo(): Promise<Record<string, unknown>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  const res = await fetch(`${TELEGRAM_API(token)}/getMe`);
  return res.json();
}

/**
 * Delete webhook (useful for switching back to polling in dev).
 */
export async function deleteWebhook(): Promise<Record<string, unknown>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  const res = await fetch(`${TELEGRAM_API(token)}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: true }),
  });
  return res.json();
}
