/**
 * GET  /api/webhook/setup  — Register webhook with Telegram
 * POST /api/webhook/setup  — Register webhook with Telegram (also accepts POST)
 * DELETE /api/webhook/setup — Remove webhook from Telegram
 *
 * Call this once after deploying to Vercel:
 *   curl https://your-app.vercel.app/api/webhook/setup
 *
 * Protected by TELEGRAM_WEBHOOK_SECRET passed as a query param:
 *   /api/webhook/setup?secret=<TELEGRAM_WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { setWebhook, getWebhookInfo, deleteWebhook, getBotInfo } from '@/services/telegram.service';

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!secret) return true; // no secret configured — open (not recommended)
  const qsSecret = req.nextUrl.searchParams.get('secret') ?? '';
  return qsSecret === secret;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const appUrl = getAppUrl();
  if (!appUrl) {
    return NextResponse.json(
      { ok: false, error: 'NEXT_PUBLIC_APP_URL is not set' },
      { status: 500 }
    );
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`;

  // Register the webhook
  const result = await setWebhook(webhookUrl);

  // Fetch additional info for the response
  const [info, bot] = await Promise.all([getWebhookInfo(), getBotInfo()]);

  return NextResponse.json({
    ok: result.ok,
    registered: webhookUrl,
    setWebhookResult: result,
    webhookInfo: info,
    botInfo: bot,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await deleteWebhook();
  return NextResponse.json({ ok: result.ok ?? false, result });
}
