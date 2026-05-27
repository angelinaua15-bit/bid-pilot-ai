/**
 * GET /api/status
 * Returns live health check for all integrations.
 *
 * Freelancehunt check behaviour:
 *   - If AUTOMATION_WORKER_URL or LOCAL_WORKER_URL is set → call GET {worker}/status
 *   - Otherwise → check storageState.json exists (local Playwright session)
 *   - Fallback → check FREELANCEHUNT_TOKEN in env
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

async function probeWorker(url: string): Promise<{
  ok: boolean;
  mode: string;
  username?: string;
  cookieCount?: number;
  sessionPath?: string;
  workerUrl: string;
  storageStateExists?: boolean;
  sessionValid?: boolean;
  autoLoop?: Record<string, unknown>;
  error?: string;
} | null> {
  try {
    const secret = process.env.AUTOMATION_SECRET ?? '';
    const res = await fetch(`${url}/status`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const fh = (data.freelancehunt ?? {}) as Record<string, unknown>;
    const connected = Boolean(fh.connected);
    // storageState file exists if sessionPath is populated (even when session is expired)
    const storageStateExists = Boolean(fh.sessionPath) || connected;
    const sessionValid = connected && Number(fh.cookieCount ?? 0) > 0;
    return {
      ok: connected,
      mode: 'local_worker',
      username: fh.username as string | undefined,
      cookieCount: fh.cookieCount as number | undefined,
      sessionPath: fh.sessionPath as string | undefined,
      workerUrl: url,
      storageStateExists,
      sessionValid,
      autoLoop: data.autoLoop as Record<string, unknown> | undefined,
      error: connected
        ? undefined
        : storageStateExists
          ? 'Freelancehunt session expired — reconnect required'
          : (fh.error as string | undefined ?? 'storageState.json not found'),
    };
  } catch {
    return null;
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
  storageStateExists?: boolean;
  sessionValid?: boolean;
  error?: string;
}> {
  // ── 1. Always try local worker first (http://localhost:8080) ─────────────
  // LOCAL_WORKER_URL defaults to http://localhost:8080 if not set.
  const localUrl = (process.env.LOCAL_WORKER_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const localResult = await probeWorker(localUrl);
  if (localResult) {
    return localResult;
  }

  // ── 2. Railway / explicit remote worker ──────────────────────────────────
  if (config.worker.enabled && config.worker.mode === 'railway') {
    try {
      const { getWorkerStatus } = await import('@/lib/worker-client');
      const status = await getWorkerStatus();
      const fh = status.freelancehunt;
      return {
        ok: fh.connected,
        mode: 'railway_worker',
        username: fh.username,
        cookieCount: fh.cookieCount,
        sessionPath: fh.sessionPath,
        workerUrl: config.worker.url,
        error: fh.connected ? undefined : (fh.error ?? 'Railway worker: session not found'),
      };
    } catch (err) {
      return {
        ok: false,
        mode: 'railway_worker',
        workerUrl: config.worker.url,
        error: `Railway worker unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Local mode: first check for storageState.json (Playwright session) ──────
  try {
    const { sessionExists, resolveSessionPath } = await import('@/services/playwright-browser.service');
    if (sessionExists()) {
      const sessionPath = resolveSessionPath();
      return {
        ok: true,
        mode: 'playwright_session',
        sessionPath,
        // We only check file existence here (fast path).
        // Deep verification (opening /my/) happens in /api/freelancehunt/status.
      };
    }
  } catch {
    // playwright-browser.service not available in this runtime — fall through
  }

  // ── Fallback: check FREELANCEHUNT_TOKEN ──────────────────────────────────
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (!token) {
    return {
      ok: false,
      mode: 'none',
      error: 'No session found. Run: npm run login:freelancehunt to save your Freelancehunt session, then start the worker.',
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

  // Determine effective worker mode label — local_worker takes priority over config
  const effectiveMode = freelancehunt.mode === 'local_worker'
    ? 'local'
    : freelancehunt.mode === 'railway_worker'
      ? 'railway'
      : config.worker.mode;

  return NextResponse.json({
    ok: allOk,
    configured,
    workerMode: config.worker.enabled || freelancehunt.mode === 'local_worker',
    workerModeLabel: effectiveMode,   // 'railway' | 'local' | 'none'
    localWorkerDetected: freelancehunt.mode === 'local_worker',
    checks: { openai, telegram, database, freelancehunt },
    timestamp: new Date().toISOString(),
  });
}
