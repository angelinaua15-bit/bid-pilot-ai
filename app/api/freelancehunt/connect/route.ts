/**
 * POST /api/freelancehunt/connect   body: { userId, email, password }
 *
 * Credential login (Variant 1). Playwright NEVER runs on Vercel — this route
 * only proxies the credentials to the Railway worker, which logs in headlessly,
 * captures the session and saves it to Supabase under userId.
 *
 * The password is forwarded once over HTTPS to the worker and is never stored
 * or logged; only the resulting session cookies are persisted.
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FALLBACK: Record<string, string> = {
  PLAYWRIGHT_NOT_INSTALLED: 'Worker не налаштований. Chromium не встановлено на Railway.',
  BROWSER_LAUNCH_FAILED:    'Не вдалося запустити браузер на worker.',
  CAPTCHA_REQUIRED:         'Freelancehunt показав капчу — автоматичний вхід неможливий.',
  INVALID_CREDENTIALS:      'Невірний email або пароль Freelancehunt.',
  WORKER_REQUIRED:          'Worker не налаштований.',
  TIMEOUT:                  'Freelancehunt не відповів вчасно. Спробуйте ще раз.',
};

export async function POST(req: Request) {
  if (!config.worker.enabled) {
    return NextResponse.json(
      { ok: false, code: 'WORKER_REQUIRED', message: 'Worker не налаштований. Перевірте AUTOMATION_WORKER_URL.' },
      { status: 200 },
    );
  }

  let body: { userId?: string; email?: string; password?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { userId, email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, code: 'MISSING_CREDENTIALS', message: 'Вкажіть email і пароль Freelancehunt.' },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`${config.worker.url}/connect/freelancehunt/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.worker.secret}` },
      body: JSON.stringify({ userId, email, password }),
      signal: AbortSignal.timeout(60_000), // headless login can take a while
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok && data.code && !data.message) data.message = FALLBACK[data.code] ?? 'Сталася помилка. Спробуйте ще раз.';
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { ok: false, code: 'WORKER_REQUIRED', message: 'Worker недоступний. Перевірте, що сервіс на Railway запущений.' },
      { status: 200 },
    );
  }
}