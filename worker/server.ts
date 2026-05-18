#!/usr/bin/env tsx
/**
 * worker/server.ts
 * BidPilot Automation Worker — runs on your local machine or VPS.
 *
 * Responsibilities:
 *   - Real Freelancehunt project parsing (REST API v2)
 *   - OpenAI bid generation
 *   - Real bid submission (REST API v2)
 *   - Telegram notifications
 *
 * No Playwright. No storageState.json. No browser automation.
 * Authentication is via FREELANCEHUNT_TOKEN only.
 *
 * Start: npm run worker:start
 *
 * Required env (.env.local or shell):
 *   AUTOMATION_SECRET      — shared secret matching Vercel's AUTOMATION_SECRET
 *   FREELANCEHUNT_TOKEN    — Freelancehunt API token
 *   OPENAI_API_KEY         — for AI bid generation
 *   TELEGRAM_BOT_TOKEN     — for notifications
 *   TELEGRAM_CHAT_ID       — your Telegram chat ID
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';

// ─── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
  console.log(`[worker] Loaded env from ${envPath}`);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT   = Number(process.env.WORKER_PORT ?? 3001);
const SECRET = process.env.AUTOMATION_SECRET ?? '';

if (!SECRET) {
  console.error('[worker] AUTOMATION_SECRET is not set. Set it in .env.local or export it in your shell.');
  process.exit(1);
}

// ─── In-memory log store ──────────────────────────────────────────────────────
interface LogEntry {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
  projectId?: string;
  projectTitle?: string;
  meta?: Record<string, unknown>;
}

const logStore: LogEntry[] = [];
const MAX_LOGS = 500;

function addLog(entry: Omit<LogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) {
  const rawMsg = entry.message;
  const message: string =
    typeof rawMsg === 'string' && rawMsg.trim() !== ''
      ? rawMsg
      : rawMsg != null
        ? String(rawMsg)
        : '(empty message)';

  const log: LogEntry = {
    id: entry.id ?? `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level ?? 'info',
    message,
    projectId:    entry.projectId    ?? undefined,
    projectTitle: entry.projectTitle ?? undefined,
    meta:         entry.meta         ?? undefined,
  };
  logStore.unshift(log);
  if (logStore.length > MAX_LOGS) logStore.splice(MAX_LOGS);
  const prefix = { info: 'INFO', success: 'OK  ', warning: 'WARN', error: 'ERR ' }[log.level] ?? 'LOG ';
  process.stdout.write(`[worker] ${prefix} ${log.message}\n`);
  return log;
}

// ─── Cycle counters ───────────────────────────────────────────────────────────
const cycleCounters = {
  parsed:    0,
  submitted: 0,
  skipped:   0,
  failed:    0,
  lastReset: new Date().toISOString(),
};

function resetCycleCounters() {
  cycleCounters.parsed    = 0;
  cycleCounters.submitted = 0;
  cycleCounters.skipped   = 0;
  cycleCounters.failed    = 0;
  cycleCounters.lastReset = new Date().toISOString();
}

// ─── Stop flag ────────────────────────────────────────────────────────────────
let stopRequested = false;
let cycleRunning  = false;

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authenticate(req: http.IncomingMessage): boolean {
  const auth = req.headers['authorization'] ?? '';
  return auth === `Bearer ${SECRET}`;
}

// ─── Request body parser ──────────────────────────────────────────────────────
function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data) as Record<string, unknown>); }
      catch { resolve({}); }
    });
  });
}

// ─── JSON response helper ─────────────────────────────────────────────────────
function json(res: http.ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleStatus(res: http.ServerResponse) {
  const tokenSet = Boolean(process.env.FREELANCEHUNT_TOKEN);

  json(res, 200, {
    ok: true,
    version: '2.0.0',
    uptime: process.uptime(),
    cycleRunning,
    stopRequested,
    counters: { ...cycleCounters },
    freelancehunt: {
      connected: tokenSet,
      authMode: 'api_token',
      error: tokenSet ? undefined : 'FREELANCEHUNT_TOKEN is not set',
    },
    openai: {
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    },
  });
}

async function handleAutoBidStart(req: http.IncomingMessage, res: http.ServerResponse) {
  if (cycleRunning) {
    return json(res, 409, { ok: false, error: 'A cycle is already running' });
  }

  const body = await readBody(req);

  cycleRunning  = true;
  stopRequested = false;
  const cycleLogs: LogEntry[] = [];

  resetCycleCounters();

  const stepLog = (level: LogEntry['level'], message: string, meta?: Record<string, unknown>) => {
    const safeEntry = {
      level,
      message: (message != null && String(message).trim() !== '') ? String(message) : '(no message)',
      meta,
    };
    const log = addLog(safeEntry);
    cycleLogs.push(log);

    const m = safeEntry.message;
    if (/BID SENT/i.test(m))                                     cycleCounters.submitted++;
    if (/SKIP|ALREADY_BID|PROJECT_CLOSED|VALIDATION_ERROR/i.test(m)) cycleCounters.skipped++;
    if (/FAILED|Cycle failed/i.test(m))                          cycleCounters.failed++;
    if (/(\d+) project/.test(m)) {
      const match = m.match(/(\d+) project/);
      if (match) cycleCounters.parsed = Number(match[1]);
    }
  };

  try {
    const { runAutoBidCycle } = await import('../services/freelancehunt-auto-bid.service');
    const { getSettings }     = await import('../lib/db');

    const dbSettings   = await getSettings();
    const bodySettings = body.settings && typeof body.settings === 'object' ? body.settings as object : {};
    const settings     = { ...dbSettings, ...bodySettings };

    addLog({
      level: 'info',
      message: `[Worker] Starting cycle — enabled=${settings.enabled} | forceRun=true | dailyLimit=${(settings as never as Record<string,unknown>).dailyLimit}`,
    });

    const chatId = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : undefined;

    const result = await runAutoBidCycle('', settings as never, chatId, stepLog, true);

    cycleCounters.submitted = result.bidsSubmitted;
    cycleCounters.skipped   = result.bidsSkipped;
    cycleCounters.failed    = result.errors;

    const summary = `Cycle complete — parsed: ${cycleCounters.parsed} | submitted: ${result.bidsSubmitted} | skipped: ${result.bidsSkipped} | failed: ${result.errors}`;
    addLog({ level: result.bidsSubmitted > 0 ? 'success' : 'info', message: summary });

    json(res, 200, {
      ok:           true,
      bidsSubmitted: result.bidsSubmitted,
      bidsSkipped:   result.bidsSkipped,
      errors:        result.errors,
      counters:      { ...cycleCounters },
      logs:          result.logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stepLog('error', `Cycle failed: ${message}`);
    json(res, 500, { ok: false, error: message, logs: cycleLogs });
  } finally {
    cycleRunning  = false;
    stopRequested = false;
  }
}

async function handleSettingsDebug(res: http.ServerResponse) {
  try {
    const { getSettings } = await import('../lib/db');
    const settings = await getSettings();
    const isSupabaseConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    json(res, 200, {
      ok: true,
      settings,
      meta: {
        source: isSupabaseConfigured ? 'supabase' : 'memory/default',
        supabaseConfigured: isSupabaseConfigured,
        workerUptime: process.uptime(),
        cycleRunning,
        stopRequested,
        freelancehuntToken: Boolean(process.env.FREELANCEHUNT_TOKEN),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { ok: false, error: message });
  }
}

function handleAutoBidStop(res: http.ServerResponse) {
  stopRequested = true;
  addLog({ level: 'warning', message: 'Emergency stop requested via API' });
  json(res, 200, { ok: true, message: 'Stop signal sent' });
}

function handleLogs(url: URL, res: http.ServerResponse) {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);
  const level = url.searchParams.get('level') ?? undefined;

  const filtered = level ? logStore.filter((l) => l.level === level) : logStore;
  const data     = filtered.slice(0, limit);

  json(res, 200, { ok: true, data, total: filtered.length });
}

async function handleGetProjects(url: URL, res: http.ServerResponse) {
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (!token) {
    return json(res, 503, {
      ok: false,
      error: 'FREELANCEHUNT_TOKEN is not set. Add it to .env.local.',
    });
  }

  try {
    const { fetchFreelancehuntProjects } = await import('../services/freelancehunt.service');
    const page      = Number(url.searchParams.get('page') ?? '1');
    const budgetMin = url.searchParams.get('budgetMin') ? Number(url.searchParams.get('budgetMin')) : undefined;
    const skills    = url.searchParams.get('skills')?.split(',').filter(Boolean) ?? undefined;

    const projects = await fetchFreelancehuntProjects(token, { page, budgetMin, skills });
    json(res, 200, { ok: true, data: projects, page });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { ok: false, error: message, data: [] });
  }
}

async function handleSendBid(req: http.IncomingMessage, res: http.ServerResponse) {
  const token = process.env.FREELANCEHUNT_TOKEN ?? '';
  if (!token) {
    return json(res, 503, { ok: false, error: 'FREELANCEHUNT_TOKEN is not set' });
  }

  try {
    const body = await readBody(req);
    const { projectUrl, text, budget, days } = body as {
      projectUrl: string;
      text:       string;
      budget:     number;
      days:       number;
    };

    if (!projectUrl || !text) {
      return json(res, 400, { ok: false, error: 'projectUrl and text are required' });
    }

    const { sendFreelancehuntBid } = await import('../services/freelancehunt.service');
    const result = await sendFreelancehuntBid(token, projectUrl, {
      text,
      budget: Number(budget) || 0,
      days:   Number(days)   || 14,
    });

    addLog({
      level: 'success',
      message: `Bid submitted via /send-bid — bidId: ${result.bidId ?? 'unknown'}`,
      meta: { projectUrl, bidId: result.bidId },
    });

    json(res, 200, { ok: true, bidId: result.bidId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { ok: false, error: message });
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    return res.end();
  }

  if (!authenticate(req)) {
    return json(res, 401, { ok: false, error: 'Unauthorized' });
  }

  const url      = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method   = req.method ?? 'GET';
  const pathname = url.pathname;

  try {
    if (method === 'GET'  && pathname === '/status')          return await handleStatus(res);
    if (method === 'GET'  && pathname === '/settings/debug')  return await handleSettingsDebug(res);
    if (method === 'POST' && pathname === '/auto-bid/start')  return await handleAutoBidStart(req, res);
    if (method === 'POST' && pathname === '/auto-bid/stop')   return handleAutoBidStop(res);
    if (method === 'GET'  && pathname === '/logs')            return handleLogs(url, res);
    if (method === 'GET'  && pathname === '/projects')        return await handleGetProjects(url, res);
    if (method === 'POST' && pathname === '/send-bid')        return await handleSendBid(req, res);

    json(res, 404, { ok: false, error: `Unknown route: ${method} ${pathname}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[worker] Unhandled error:', message);
    json(res, 500, { ok: false, error: message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[worker] BidPilot Worker v2 running on http://0.0.0.0:${PORT}`);
  console.log(`[worker] Set AUTOMATION_WORKER_URL=http://YOUR_LOCAL_IP:${PORT} in Vercel`);
  console.log('[worker] Waiting for requests...\n');

  const tokenSet = Boolean(process.env.FREELANCEHUNT_TOKEN);
  addLog({
    level: tokenSet ? 'success' : 'warning',
    message: tokenSet
      ? 'FREELANCEHUNT_TOKEN loaded — REST API mode active'
      : 'FREELANCEHUNT_TOKEN not set — add it to .env.local',
  });

  if (!process.env.OPENAI_API_KEY) {
    addLog({ level: 'warning', message: 'OPENAI_API_KEY not set — will use template bids' });
  }
});

// Graceful shutdown
process.on('SIGINT',  () => { console.log('\n[worker] Shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
