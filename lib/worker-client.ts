/**
 * lib/worker-client.ts
 * Typed HTTP client for the external automation worker.
 *
 * When AUTOMATION_WORKER_URL is set, Vercel delegates all Playwright/Freelancehunt
 * work to the worker instead of running it locally.
 *
 * Every request includes:
 *   Authorization: Bearer <AUTOMATION_SECRET>
 *
 * Worker expected endpoints:
 *   GET  /status            — worker health + Freelancehunt session info
 *   POST /auto-bid/start    — trigger one auto-bid cycle
 *   POST /auto-bid/stop     — emergency stop
 *   GET  /logs              — recent automation logs
 */

import { config } from '@/lib/config';

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface WorkerFreelancehuntStatus {
  connected: boolean;
  username?: string;
  cookieCount?: number;
  sessionPath?: string;
  error?: string;
}

export interface WorkerAutoLoopStatus {
  enabled: boolean;
  intervalMs: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface WorkerStatus {
  ok: boolean;
  freelancehunt: WorkerFreelancehuntStatus;
  autoLoop?: WorkerAutoLoopStatus;
  version?: string;
  uptime?: number;
}

export interface WorkerRunResult {
  ok: boolean;
  bidsSubmitted: number;
  bidsSkipped: number;
  errors: number;
  logs?: WorkerLog[];
  error?: string;
  code?: string;
  message?: string;
}

export interface WorkerLog {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
  projectId?: string;
  projectTitle?: string;
  meta?: Record<string, unknown>;
}

export interface WorkerLogsResult {
  ok: boolean;
  data: WorkerLog[];
  total: number;
  error?: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

class WorkerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

async function workerFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  const { url, secret } = config.worker;

  if (!url) {
    throw new WorkerError('AUTOMATION_WORKER_URL is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${url}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
        ...options.headers,
      },
    });

    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new WorkerError(
        `Worker returned non-JSON HTTP ${res.status} with HTML. URL: ${url}${path} — check AUTOMATION_WORKER_URL env var. Preview: ${text.slice(0, 120)}`,
        res.status,
      );
    }

    if (!res.ok) {
      const msg = (json as Record<string, unknown>)?.error as string ?? `HTTP ${res.status}`;
      throw new WorkerError(msg, res.status);
    }

    return json;
  } catch (err) {
    if (err instanceof WorkerError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorkerError(
      msg.includes('abort') || msg.includes('timeout')
        ? `Worker timed out after ${timeoutMs}ms`
        : `Worker unreachable: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** GET /status — returns worker health and Freelancehunt session info. */
export async function getWorkerStatus(): Promise<WorkerStatus> {
  return workerFetch<WorkerStatus>('/status', { method: 'GET' });
}

/** POST /auto-bid/start — triggers one full auto-bid cycle on the worker. */
export async function startWorkerAutoBid(
  payload?: Record<string, unknown>,
): Promise<WorkerRunResult> {
  const base: WorkerRunResult = { ok: false, bidsSubmitted: 0, bidsSkipped: 0, errors: 0 };

  // Worker not configured → Playwright cannot run on Vercel → WORKER_REQUIRED.
  if (!config.worker.url) {
    return { ...base, code: 'WORKER_REQUIRED', message: 'Worker не налаштований. Chromium не встановлено на Railway.' };
  }

  try {
    return await workerFetch<WorkerRunResult>('/auto-bid/start', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }, 120_000); // 2-min timeout — cycle can take a while
  } catch (err) {
    // Never leak a raw stack to the caller — return a structured result.
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, code: 'WORKER_REQUIRED', message: 'Worker недоступний.', error: msg.slice(0, 200) };
  }
}

/** POST /auto-bid/stop — sends emergency stop to the worker. */
export async function stopWorkerAutoBid(): Promise<{ ok: boolean }> {
  return workerFetch<{ ok: boolean }>('/auto-bid/stop', { method: 'POST' });
}

/** GET /logs — fetches recent automation logs from the worker. */
export async function getWorkerLogs(params?: {
  limit?: number;
  level?: string;
}): Promise<WorkerLogsResult> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.level) qs.set('level', params.level);
  const query = qs.toString() ? `?${qs}` : '';
  return workerFetch<WorkerLogsResult>(`/logs${query}`, { method: 'GET' });
}

export { WorkerError };