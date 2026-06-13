/**
 * services/freelancehunt-session.service.ts
 *
 * Per-user Freelancehunt session storage in Supabase — the single source of
 * truth for "is this user connected?". Durable across Railway redeploys (unlike
 * local session files) and readable from Vercel (unlike the worker's disk).
 *
 * NO Playwright import here — this module is safe to bundle in a Vercel route.
 * The actual browser context is built in playwright-browser.service.ts, which
 * reads the storageState via getStorageState() below.
 *
 * Table (create once in Supabase SQL editor):
 *
 *   create table if not exists freelancehunt_sessions (
 *     user_id      text primary key,
 *     storage_state jsonb not null,
 *     username     text,
 *     cookie_count integer not null default 0,
 *     status       text not null default 'connected',
 *     updated_at   timestamptz not null default now()
 *   );
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'freelancehunt_sessions';
const MAX_AGE_DAYS = Number(process.env.FH_SESSION_MAX_AGE_DAYS ?? 25);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // unix seconds, -1 for session cookies
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface PlaywrightStorageState {
  cookies: PlaywrightCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

export interface FreelancehuntSessionStatus {
  userId: string;
  connected: boolean;
  status: 'connected' | 'reconnect';
  username?: string;
  cookieCount: number;
  updatedAt?: string;
  reason?: string;
}

// ─── Supabase client (lazy, server-only) ──────────────────────────────────────

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

interface SessionRow {
  user_id: string;
  storage_state: PlaywrightStorageState;
  username: string | null;
  cookie_count: number;
  status: string;
  updated_at: string;
}

// ─── Validity ─────────────────────────────────────────────────────────────────

function isStillValid(row: SessionRow): { valid: boolean; reason?: string } {
  if (row.status === 'expired') return { valid: false, reason: 'marked expired' };
  const cookies = row.storage_state?.cookies ?? [];
  if (cookies.length === 0) return { valid: false, reason: 'no cookies' };

  const now = Date.now() / 1000;
  const hasLiveCookie = cookies.some((c) => c.expires === -1 || c.expires > now);
  if (!hasLiveCookie) return { valid: false, reason: 'all cookies expired' };

  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  if (ageMs > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    return { valid: false, reason: `older than ${MAX_AGE_DAYS} days` };
  }
  return { valid: true };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Status for the UI / status route. Never throws — returns 'reconnect' on any problem. */
export async function getSessionStatus(userId: string): Promise<FreelancehuntSessionStatus> {
  const base: FreelancehuntSessionStatus = {
    userId, connected: false, status: 'reconnect', cookieCount: 0,
  };
  if (!userId) return { ...base, reason: 'no userId' };

  const client = getClient();
  if (!client) return { ...base, reason: 'supabase not configured' };

  const { data, error } = await client
    .from(TABLE)
    .select('user_id, storage_state, username, cookie_count, status, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return { ...base, reason: `db error: ${error.message}` };
  if (!data) return { ...base, reason: 'no session row' };

  const row = data as SessionRow;
  const { valid, reason } = isStillValid(row);

  return {
    userId,
    connected: valid,
    status: valid ? 'connected' : 'reconnect',
    username: row.username ?? undefined,
    cookieCount: row.cookie_count ?? (row.storage_state?.cookies?.length ?? 0),
    updatedAt: row.updated_at,
    reason: valid ? undefined : reason,
  };
}

/** Raw storageState for building a Playwright context. null if missing/unconfigured. */
export async function getStorageState(userId: string): Promise<PlaywrightStorageState | null> {
  if (!userId) return null;
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .select('storage_state, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  if ((data as { status: string }).status === 'expired') return null;
  return (data as { storage_state: PlaywrightStorageState }).storage_state ?? null;
}

/** Upsert a user's session. Called by the worker after a successful login-save. */
export async function saveSession(
  userId: string,
  storageState: PlaywrightStorageState,
  username?: string | null
): Promise<{ ok: boolean; reason?: string }> {
  if (!userId) return { ok: false, reason: 'no userId' };
  const client = getClient();
  if (!client) return { ok: false, reason: 'supabase not configured' };

  const { error } = await client.from(TABLE).upsert(
    {
      user_id: userId,
      storage_state: storageState,
      username: username ?? null,
      cookie_count: storageState?.cookies?.length ?? 0,
      status: 'connected',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** Mark a user's session expired (e.g. worker detected a login wall). */
export async function markExpired(userId: string): Promise<void> {
  if (!userId) return;
  const client = getClient();
  if (!client) return;
  await client.from(TABLE).update({ status: 'expired' }).eq('user_id', userId);
}

/** Remove a user's session entirely (disconnect). */
export async function deleteSession(userId: string): Promise<void> {
  if (!userId) return;
  const client = getClient();
  if (!client) return;
  await client.from(TABLE).delete().eq('user_id', userId);
}