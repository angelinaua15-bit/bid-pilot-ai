/**
 * lib/db.ts
 * Unified persistence layer backed by Supabase (service role).
 *
 * Falls back to an in-memory store when Supabase env vars are absent
 * so the app works in demo mode without a database connection.
 *
 * Tables (created by migration 001_create_bidpilot_tables):
 *   public.auto_bid_settings  (id BIGINT, data JSONB, updated_at)
 *   public.auto_bid_logs      (id TEXT PK, level, message, …, created_at)
 *   public.bids               (id TEXT PK, data JSONB, status, created_at)
 */

import { defaultAutoBidSettings, mockLogs, mockBids } from '@/lib/mock-data';
import type { AutoBidSettings, AutoBidLog, GeneratedBid } from '@/types';

// ─── In-memory fallback store ─────────────────────────────────────────────────

let _memSettings: AutoBidSettings = { ...defaultAutoBidSettings };
const _memLogs: AutoBidLog[] = [...mockLogs];
const _memBids: GeneratedBid[] = [...mockBids];

// ─── Supabase service client (lazy) ──────────────────────────────────────────

function getDb() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getServiceClient } = require('@/lib/supabase/service') as typeof import('@/lib/supabase/service');
    return getServiceClient();
  } catch {
    return null;
  }
}

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AutoBidSettings> {
  if (!isSupabaseConfigured) {
    console.log(`[db] getSettings source=memory enabled=${_memSettings.enabled} (Supabase not configured)`);
    return { ..._memSettings };
  }

  try {
    const db = getDb();
    if (!db) {
      console.log(`[db] getSettings source=memory enabled=${_memSettings.enabled} (Supabase client unavailable)`);
      return { ..._memSettings };
    }

    const { data, error } = await db
      .from('auto_bid_settings')
      .select('data')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      console.log(`[db] getSettings source=default enabled=${defaultAutoBidSettings.enabled} (no row in DB)`);
      return { ...defaultAutoBidSettings };
    }
    const settings = data.data as AutoBidSettings;
    console.log(`[db] getSettings source=database enabled=${settings.enabled} dailyLimit=${settings.dailyLimit}`);
    return settings;
  } catch (err) {
    console.error('[db] getSettings error:', err);
    console.log(`[db] getSettings source=memory-fallback enabled=${_memSettings.enabled} (error fallback)`);
    return { ..._memSettings };
  }
}

export async function saveSettings(settings: AutoBidSettings): Promise<AutoBidSettings> {
  if (!isSupabaseConfigured) {
    _memSettings = { ...settings };
    return _memSettings;
  }

  try {
    const db = getDb();
    if (!db) { _memSettings = { ...settings }; return settings; }

    // Check if a row exists
    const { data: existing } = await db
      .from('auto_bid_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from('auto_bid_settings')
        .update({ data: settings, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db
        .from('auto_bid_settings')
        .insert({ data: settings, updated_at: new Date().toISOString() });
      if (error) throw error;
    }

    return settings;
  } catch (err) {
    console.error('[db] saveSettings error:', err);
    _memSettings = { ...settings };
    return settings;
  }
}

export async function patchSettings(patch: Partial<AutoBidSettings>): Promise<AutoBidSettings> {
  const current = await getSettings();
  return saveSettings({ ...current, ...patch });
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export async function appendLog(entry: AutoBidLog): Promise<void> {
  if (!isSupabaseConfigured) {
    _memLogs.unshift(entry);
    if (_memLogs.length > 500) _memLogs.splice(500);
    return;
  }

  try {
    const db = getDb();
    if (!db) { _memLogs.unshift(entry); return; }

    const { error } = await db.from('auto_bid_logs').upsert(
      {
        id:            entry.id,
        level:         entry.level,
        message:       entry.message,
        project_id:    entry.projectId   ?? null,
        project_title: entry.projectTitle ?? null,
        bid_id:        entry.bidId        ?? null,
        meta:          entry.meta         ?? null,
        created_at:    entry.timestamp,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (error) throw error;
  } catch (err) {
    console.error('[db] appendLog error:', err);
    _memLogs.unshift(entry);
  }
}

export async function getLogs(options?: {
  limit?: number;
  level?: string;
  projectId?: string;
}): Promise<{ logs: AutoBidLog[]; total: number }> {
  const limit = Math.min(options?.limit ?? 100, 500);

  if (!isSupabaseConfigured) {
    let logs = [..._memLogs];
    if (options?.level)     logs = logs.filter((l) => l.level === options.level);
    if (options?.projectId) logs = logs.filter((l) => l.projectId === options.projectId);
    return { logs: logs.slice(0, limit), total: _memLogs.length };
  }

  try {
    const db = getDb();
    if (!db) return { logs: _memLogs.slice(0, limit), total: _memLogs.length };

    let query = db
      .from('auto_bid_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.level)     query = query.eq('level', options.level);
    if (options?.projectId) query = query.eq('project_id', options.projectId);

    const { data, error, count } = await query;
    if (error) throw error;

    const logs: AutoBidLog[] = (data ?? []).map((r) => ({
      id:           r.id,
      level:        r.level,
      message:      r.message,
      projectId:    r.project_id    ?? undefined,
      projectTitle: r.project_title ?? undefined,
      bidId:        r.bid_id        ?? undefined,
      meta:         r.meta          ?? undefined,
      timestamp:    r.created_at,
    }));

    return { logs, total: count ?? logs.length };
  } catch (err) {
    console.error('[db] getLogs error:', err);
    return { logs: _memLogs.slice(0, limit), total: _memLogs.length };
  }
}

export async function clearLogs(): Promise<void> {
  if (!isSupabaseConfigured) { _memLogs.splice(0); return; }

  try {
    const db = getDb();
    if (!db) { _memLogs.splice(0); return; }
    const { error } = await db.from('auto_bid_logs').delete().neq('id', '');
    if (error) throw error;
  } catch (err) {
    console.error('[db] clearLogs error:', err);
    _memLogs.splice(0);
  }
}

// ─── Bids ─────────────────────────────────────────────────────────────────────

export async function saveBid(bid: GeneratedBid): Promise<void> {
  if (!isSupabaseConfigured) {
    _memBids.unshift(bid);
    if (_memBids.length > 1000) _memBids.splice(1000);
    return;
  }

  try {
    const db = getDb();
    if (!db) { _memBids.unshift(bid); return; }

    const { error } = await db.from('bids').upsert(
      {
        id:         bid.id,
        data:       bid,
        status:     bid.status ?? 'draft',
        created_at: bid.createdAt,
      },
      { onConflict: 'id' }
    );
    if (error) throw error;
  } catch (err) {
    console.error('[db] saveBid error:', err);
    _memBids.unshift(bid);
  }
}

export async function getBids(options?: {
  limit?: number;
  status?: string;
}): Promise<{ bids: GeneratedBid[]; total: number }> {
  const limit = Math.min(options?.limit ?? 50, 200);

  if (!isSupabaseConfigured) {
    let bids = [..._memBids];
    if (options?.status) bids = bids.filter((b) => b.status === options.status);
    return { bids: bids.slice(0, limit), total: _memBids.length };
  }

  try {
    const db = getDb();
    if (!db) return { bids: _memBids.slice(0, limit), total: _memBids.length };

    let query = db
      .from('bids')
      .select('data', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.status) query = query.eq('status', options.status);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      bids:  (data ?? []).map((r) => r.data as GeneratedBid),
      total: count ?? 0,
    };
  } catch (err) {
    console.error('[db] getBids error:', err);
    return { bids: _memBids.slice(0, limit), total: _memBids.length };
  }
}
