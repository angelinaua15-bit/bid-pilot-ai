/**
 * GET /api/status
 * Returns live health check for all integrations.
 *
 * Freelancehunt check behaviour:
 *   - If AUTOMATION_WORKER_URL is set → call GET {worker}/status
 *   - Otherwise → check FREELANCEHUNT_TOKEN in env
 */

import { NextResponse } from 'next/server';
import { config, getIntegrationStatus } from '@/lib/config';

async function checkOpenAI(): Promise<{ ok: boolean; model?: string; error?: string }> {
  if (!config.openai.apiKey) return { ok: false, error: 'OPENAI_API_KEY not set' };
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, model: config.openai.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkTelegram(): Promise<{ ok: boolean; username?: string; chatId?: number | null; error?: string }> {
  if (!config.telegram.botToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
  if (!config.telegram.chatId)   return { ok: false, error: 'TELEGRAM_CHAT_ID not set' };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/getMe`,
      { signal: AbortSignal.timeout(5000) }
    );
    const json = await res.json();
    if (!json.ok) return { ok: false, error: json.description ?? 'Unknown error' };
    return { ok: true, username: json.result.username, chatId: config.telegram.chatId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Timeout' };
  }
}

async function checkDatabase(): Promise<{ ok: boolean; backend?: string; error?: string }> {
  if (!config.db.isConfigured) return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set' };
  try {
    const { getServiceClient } = await import('@/lib/supabase/service');
    const db = getServiceClient();
    if (!db) return { ok: false, error: 'Supabase env vars missing' };
    const { error } = await db
      .from('auto_bid_settings')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    return { ok: true, backend: 'Supabase' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

async function checkFreelancehunt(): Promise<{
  ok: boolean;
  mode?: string;
  username?: string;
  sessionPath?: string;
  checkedPaths?: string[];
  cookieCount?: number;
  workerUrl?: string;
  error?: string;
}> {
  // ── Worker mode: delegate to external worker ──────────────────────────────
  if (config.worker.enabled) {
    try {
      const { getWorkerStatus } = await import('@/lib/worker-client');
      const status = await getWorkerStatus();
      const fh = status.freelancehunt;
      return {
        ok: fh.connected,
        mode: 'worker',
        username: fh.username,
        cookieCount: fh.cookieCount,
        sessionPath: fh.sessionPath,
        workerUrl: config.worker.url,
        error: fh.connected ? undefined : (fh.error ?? 'Worker reports Freelancehunt not connected'),
      };
    } catch (err) {
      return {
        ok: false,
        mode: 'worker',
        workerUrl: config.worker.url,
        error: `Worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Local mode: check FREELANCEHUNT_TOKEN ───────────────────────────────
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (!token) {
    return {
      ok: false,
      mode: 'api_token',
      error: 'FREELANCEHUNT_TOKEN is not set. Add it to your environment variables.',
    };
  }

  // Validate the token against the Freelancehunt API
  try {
    const { validateFreelancehuntToken } = await import('@/services/freelancehunt.service');
    const result = await validateFreelancehuntToken(token);
    return {
      ok: result.valid,
      mode: 'api_token',
      username: result.username,
      error: result.valid ? undefined : 'Token invalid or expired',
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'api_token',
      error: err instanceof Error ? err.message : 'Token validation failed',
    };
  }
}

export async function GET() {
  const configured = getIntegrationStatus();

  const [openai, telegram, database, freelancehunt] = await Promise.all([
    checkOpenAI(),
    checkTelegram(),
    checkDatabase(),
    checkFreelancehunt(),
  ]);

  const allOk = openai.ok && telegram.ok && freelancehunt.ok;

  return NextResponse.json({
    ok: allOk,
    configured,
    workerMode: config.worker.enabled,
    checks: { openai, telegram, database, freelancehunt },
    timestamp: new Date().toISOString(),
  });
}
