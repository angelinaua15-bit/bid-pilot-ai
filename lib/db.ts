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
import type {
  AutoBidSettings, AutoBidLog, GeneratedBid, Application,
  SaaSUser, FreelanceAccount, FreelanceFilter,
  TelegramChannel, TelegramBot, Campaign, CampaignMessage,
  SaaSDashboardStats, PaymentSetting, ManualPayment, ManualPaymentPlan,
} from '@/types';
import { OWNER_TELEGRAM_ID } from '@/types';

// ─── In-memory fallback store ─────────────────────────────────────────────────

let _memSettings: AutoBidSettings = { ...defaultAutoBidSettings };
const _memLogs: AutoBidLog[] = [...mockLogs];
const _memBids: GeneratedBid[] = [...mockBids];
// Applications store — no mock data, only real worker output
const _memApplications: Application[] = [];

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

export async function appendLog(entry: AutoBidLog & { userId?: string }): Promise<void> {
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
        user_id:       entry.userId       ?? null,
        level:         entry.level,
        message:       entry.message,
        project_id:    entry.projectId    ?? null,
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
  userId?: string;
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
    if (options?.userId)    query = query.eq('user_id', options.userId);

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

// ─── Bids ───────────────────────────────────────��─────────────────────────────

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

// ─── Applications ─────────────────────────────────────────────────────────────

/**
 * Save a worker-processed application record (sent, skipped, or failed).
 * Uses the `applications` table in Supabase; falls back to in-memory.
 */
export async function saveApplication(app: Application): Promise<void> {
  if (!isSupabaseConfigured) {
    // Remove existing with same id to avoid duplicates, then prepend
    const idx = _memApplications.findIndex((a) => a.id === app.id);
    if (idx !== -1) _memApplications.splice(idx, 1);
    _memApplications.unshift(app);
    if (_memApplications.length > 2000) _memApplications.splice(2000);
    return;
  }

  try {
    const db = getDb();
    if (!db) {
      const idx = _memApplications.findIndex((a) => a.id === app.id);
      if (idx !== -1) _memApplications.splice(idx, 1);
      _memApplications.unshift(app);
      return;
    }

    const { error } = await db.from('applications').upsert(
      {
        id:                     app.id,
        user_id:                app.userId             ?? null,
        freelance_account_id:   app.freelanceAccountId ?? null,
        project_id:             app.projectId,
        freelancehunt_id:       app.freelancehuntId    ?? null,
        title:                  app.title,
        url:                    app.url,
        budget:                 app.budget,
        currency:               app.currency,
        deadline:               app.deadline           ?? null,
        status:                 app.status,
        created_at:             app.createdAt,
        sent_at:                app.sentAt             ?? null,
        proposal_text:          app.proposalText       ?? null,
        proposal_price:         app.proposalPrice      ?? null,
        freelancehunt_bid_id:   app.freelancehuntBidId ?? null,
        ai_score:               app.aiScore            ?? null,
        matched_keywords:       app.matchedKeywords    ?? null,
        blocked_keywords:       app.blockedKeywords    ?? null,
        skipped_reason:         app.skippedReason      ?? null,
        filter_stage:           app.filterStage        ?? null,
      },
      { onConflict: 'id' }
    );
    if (error) throw error;
  } catch (err) {
    console.error('[db] saveApplication error:', err);
    const idx = _memApplications.findIndex((a) => a.id === app.id);
    if (idx !== -1) _memApplications.splice(idx, 1);
    _memApplications.unshift(app);
  }
}

export async function getApplications(options?: {
  limit?: number;
  status?: 'sent' | 'sent_unconfirmed' | 'skipped' | 'failed' | 'all';
  userId?: string;
}): Promise<{ applications: Application[]; total: number }> {
  const limit        = Math.min(options?.limit ?? 50, 500);
  const statusFilter = options?.status === 'all' ? undefined : options?.status;

  if (!isSupabaseConfigured) {
    let apps = [..._memApplications];
    if (statusFilter)      apps = apps.filter((a) => a.status === statusFilter);
    if (options?.userId)   apps = apps.filter((a) => a.userId === options.userId);
    return { applications: apps.slice(0, limit), total: apps.length };
  }

  try {
    const db = getDb();
    if (!db) {
      let apps = [..._memApplications];
      if (statusFilter)    apps = apps.filter((a) => a.status === statusFilter);
      if (options?.userId) apps = apps.filter((a) => a.userId === options.userId);
      return { applications: apps.slice(0, limit), total: apps.length };
    }

    let query = db
      .from('applications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusFilter)    query = query.eq('status', statusFilter);
    if (options?.userId) query = query.eq('user_id', options.userId);

    const { data, error, count } = await query;
    if (error) throw error;

    const applications: Application[] = (data ?? []).map((r) => ({
      id:                    r.id,
      userId:                r.user_id              ?? undefined,
      freelanceAccountId:    r.freelance_account_id ?? undefined,
      projectId:             r.project_id,
      freelancehuntId:       r.freelancehunt_id     ?? undefined,
      title:                 r.title,
      url:                   r.url,
      budget:                r.budget,
      currency:              r.currency,
      deadline:              r.deadline             ?? undefined,
      status:                r.status as Application['status'],
      createdAt:             r.created_at,
      sentAt:                r.sent_at              ?? undefined,
      proposalText:          r.proposal_text        ?? undefined,
      proposalPrice:         r.proposal_price       ?? undefined,
      freelancehuntBidId:    r.freelancehunt_bid_id ?? undefined,
      aiScore:               r.ai_score             ?? undefined,
      matchedKeywords:       r.matched_keywords     ?? undefined,
      blockedKeywords:       r.blocked_keywords     ?? undefined,
      skippedReason:         r.skipped_reason       ?? undefined,
      filterStage:           r.filter_stage         ?? undefined,
    }));

    return { applications, total: count ?? applications.length };
  } catch (err) {
    console.error('[db] getApplications error:', err);
    let apps = [..._memApplications];
    if (statusFilter)    apps = apps.filter((a) => a.status === statusFilter);
    if (options?.userId) apps = apps.filter((a) => a.userId === options.userId);
    return { applications: apps.slice(0, limit), total: apps.length };
  }
}

// ─── SaaS: Users ─────────────────────────────────────────────────────────────

export async function getOrCreateUser(telegramId: number, name: string, username?: string): Promise<SaaSUser | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const isOwner = telegramId === OWNER_TELEGRAM_ID;

    const { data: existing } = await db.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();
    if (existing) {
      // Always enforce owner privileges for the owner account
      if (isOwner && (existing.role !== 'owner' || existing.subscription_plan !== 'unlimited')) {
        const { data: updated } = await db.from('users')
          .update({ role: 'owner', subscription_plan: 'unlimited', subscription_status: 'active', updated_at: new Date().toISOString() })
          .eq('id', existing.id).select('*').single();
        if (updated) return mapUser(updated);
      }
      return mapUser(existing);
    }

    const { data: created, error } = await db.from('users')
      .insert({
        telegram_id: telegramId,
        name,
        username: username ?? null,
        role: isOwner ? 'owner' : 'user',
        subscription_plan: isOwner ? 'unlimited' : 'free',
        subscription_status: 'active',
      })
      .select('*').single();
    if (error) throw error;
    return mapUser(created);
  } catch (err) { console.error('[db] getOrCreateUser error:', err); return null; }
}

export async function getUserById(id: string): Promise<SaaSUser | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const { data } = await db.from('users').select('*').eq('id', id).maybeSingle();
    return data ? mapUser(data) : null;
  } catch (err) { console.error('[db] getUserById error:', err); return null; }
}

export async function getAllUsers(limit = 100): Promise<SaaSUser[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    const { data } = await db.from('users').select('*').order('created_at', { ascending: false }).limit(limit);
    return (data ?? []).map(mapUser);
  } catch (err) { console.error('[db] getAllUsers error:', err); return []; }
}

export async function updateUserPlan(id: string, plan: string, expiresAt?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.from('users').update({
      subscription_plan: plan,
      subscription_status: 'active',
      subscription_expires_at: expiresAt ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  } catch (err) { console.error('[db] updateUserPlan error:', err); }
}

export async function disableUser(id: string, disabled: boolean): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.from('users').update({ is_disabled: disabled, updated_at: new Date().toISOString() }).eq('id', id);
  } catch (err) { console.error('[db] disableUser error:', err); }
}

function mapUser(r: Record<string, unknown>): SaaSUser {
  return {
    id:                     r.id as string,
    telegramId:             r.telegram_id as number,
    name:                   r.name as string,
    username:               r.username as string | undefined,
    avatarUrl:              r.avatar_url as string | undefined,
    role:                   (r.role as string ?? 'user') as SaaSUser['role'],
    subscriptionPlan:       (r.subscription_plan as string ?? 'free') as SaaSUser['subscriptionPlan'],
    subscriptionStatus:     (r.subscription_status as string ?? 'active') as SaaSUser['subscriptionStatus'],
    subscriptionExpiresAt:  r.subscription_expires_at as string | undefined,
    applicationsThisMonth:  (r.applications_this_month as number) ?? 0,
    isDisabled:             (r.is_disabled as boolean) ?? false,
    createdAt:              r.created_at as string,
    updatedAt:              r.updated_at as string,
  };
}

// ─── SaaS: Freelance Accounts ─────────────────────────────────────────────────

export async function getFreelanceAccount(userId: string): Promise<FreelanceAccount | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const { data } = await db.from('freelance_accounts').select('*').eq('user_id', userId).maybeSingle();
    return data ? mapFreelanceAccount(data) : null;
  } catch (err) { console.error('[db] getFreelanceAccount error:', err); return null; }
}

export async function upsertFreelanceAccount(acc: Partial<FreelanceAccount> & { userId: string }): Promise<FreelanceAccount | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const { data: existing } = await db.from('freelance_accounts').select('*').eq('user_id', acc.userId).maybeSingle();
    if (existing) {
      const updatePayload: Record<string, unknown> = {
        account_name:  acc.accountName  ?? existing.account_name,
        status:        acc.status       ?? existing.status,
        last_login_at: acc.lastLoginAt  ?? existing.last_login_at,
        last_check_at: acc.lastCheckAt  ?? existing.last_check_at,
        updated_at:    now,
      };
      if (acc.apiToken) updatePayload.api_token = acc.apiToken;
      const { data, error } = await db.from('freelance_accounts').update(updatePayload).eq('user_id', acc.userId).select('*').single();
      if (error) throw error;
      return mapFreelanceAccount(data);
    } else {
      const { data, error } = await db.from('freelance_accounts').insert({
        user_id:      acc.userId,
        platform:     acc.platform ?? 'freelancehunt',
        account_name: acc.accountName ?? null,
        api_token:    acc.apiToken ?? null,
        status:       acc.status ?? 'disconnected',
        last_login_at: acc.lastLoginAt ?? null,
        created_at:   now,
        updated_at:   now,
      }).select('*').single();
      if (error) throw error;
      return mapFreelanceAccount(data);
    }
  } catch (err) { console.error('[db] upsertFreelanceAccount error:', err); return null; }
}

function mapFreelanceAccount(r: Record<string, unknown>): FreelanceAccount {
  return {
    id:           r.id as string,
    userId:       r.user_id as string,
    platform:     r.platform as string,
    accountName:  r.account_name as string | undefined,
    apiToken:     r.api_token as string | undefined,
    status:       (r.status as string ?? 'disconnected') as FreelanceAccount['status'],
    lastLoginAt:  r.last_login_at as string | undefined,
    lastCheckAt:  r.last_check_at as string | undefined,
    createdAt:    r.created_at as string,
    updatedAt:    r.updated_at as string,
  };
}

// ─── SaaS: Freelance Filters ──────────────────────────────────────────────────

export async function getFreelanceFilter(userId: string): Promise<FreelanceFilter | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const { data } = await db.from('freelance_filters').select('*').eq('user_id', userId).maybeSingle();
    return data ? mapFreelanceFilter(data) : null;
  } catch (err) { console.error('[db] getFreelanceFilter error:', err); return null; }
}

export async function upsertFreelanceFilter(f: Partial<FreelanceFilter> & { userId: string }): Promise<FreelanceFilter | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      user_id:           f.userId,
      min_budget_uah:    f.minBudgetUah    ?? 2000,
      min_budget_usd:    f.minBudgetUsd    ?? 50,
      allowed_keywords:  f.allowedKeywords ?? [],
      blocked_keywords:  f.blockedKeywords ?? [],
      allowed_categories: f.allowedCategories ?? [],
      blocked_categories: f.blockedCategories ?? [],
      ai_score_min:      f.aiScoreMin      ?? 0,
      daily_limit:       f.dailyLimit      ?? 20,
      proposal_style:    f.proposalStyle   ?? 'expert',
      is_enabled:        f.isEnabled       ?? false,
      updated_at:        now,
    };
    const { data, error } = await db.from('freelance_filters')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*').single();
    if (error) throw error;
    return mapFreelanceFilter(data);
  } catch (err) { console.error('[db] upsertFreelanceFilter error:', err); return null; }
}

function mapFreelanceFilter(r: Record<string, unknown>): FreelanceFilter {
  return {
    id:                r.id as string,
    userId:            r.user_id as string,
    minBudgetUah:      (r.min_budget_uah as number) ?? 2000,
    minBudgetUsd:      (r.min_budget_usd as number) ?? 50,
    allowedKeywords:   (r.allowed_keywords as string[]) ?? [],
    blockedKeywords:   (r.blocked_keywords as string[]) ?? [],
    allowedCategories: (r.allowed_categories as string[]) ?? [],
    blockedCategories: (r.blocked_categories as string[]) ?? [],
    aiScoreMin:        (r.ai_score_min as number) ?? 0,
    dailyLimit:        (r.daily_limit as number) ?? 20,
    proposalStyle:     (r.proposal_style as FreelanceFilter['proposalStyle']) ?? 'expert',
    isEnabled:         (r.is_enabled as boolean) ?? false,
    createdAt:         r.created_at as string,
    updatedAt:         r.updated_at as string,
  };
}

export async function incrementBidCount(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.rpc('increment_bid_count', { p_user_id: userId }).throwOnError();
  } catch {
    // Fallback: manual increment
    try {
      const db2 = getDb(); if (!db2) return;
      const { data: acc } = await db2.from('freelance_accounts').select('bid_count').eq('user_id', userId).maybeSingle();
      const current = (acc?.bid_count as number) ?? 0;
      await db2.from('freelance_accounts').update({ bid_count: current + 1, updated_at: new Date().toISOString() }).eq('user_id', userId);
    } catch (err2) { console.error('[db] incrementBidCount fallback error:', err2); }
  }
}

// ─── SaaS: Telegram Channels ──────────────────────────────────────────────────

/** Fetch all channels (up to 10 000). Prefer getTelegramChannelsPaginated for UI. */
export async function getTelegramChannels(options?: { status?: string; limit?: number }): Promise<TelegramChannel[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    let query = db.from('telegram_channels').select('*').order('created_at', { ascending: false }).limit(options?.limit ?? 10_000);
    if (options?.status) query = query.eq('status', options.status);
    const { data } = await query;
    return (data ?? []).map(mapChannel);
  } catch (err) { console.error('[db] getTelegramChannels error:', err); return []; }
}

/** Paginated channel query with optional full-text search and category filter. */
export async function getTelegramChannelsPaginated(options: {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  status?: string;
}): Promise<{ channels: TelegramChannel[]; total: number }> {
  if (!isSupabaseConfigured) return { channels: [], total: 0 };
  try {
    const db = getDb(); if (!db) return { channels: [], total: 0 };
    const page     = Math.max(1, options.page     ?? 1);
    const pageSize = Math.min(100, options.pageSize ?? 50);
    const from     = (page - 1) * pageSize;
    const to       = from + pageSize - 1;

    let query = db.from('telegram_channels')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (options.status)   query = query.eq('status', options.status);
    if (options.category) query = query.eq('category', options.category);
    if (options.search) {
      const q = `%${options.search}%`;
      query = query.or(`title.ilike.${q},username_or_link.ilike.${q},notes.ilike.${q}`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { channels: (data ?? []).map(mapChannel), total: count ?? 0 };
  } catch (err) {
    console.error('[db] getTelegramChannelsPaginated error:', err);
    return { channels: [], total: 0 };
  }
}

/** Count channels, optionally filtered. */
export async function getTelegramChannelCount(options?: { status?: string; category?: string }): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  try {
    const db = getDb(); if (!db) return 0;
    let query = db.from('telegram_channels').select('id', { count: 'exact', head: true });
    if (options?.status)   query = query.eq('status', options.status);
    if (options?.category) query = query.eq('category', options.category);
    const { count } = await query;
    return count ?? 0;
  } catch { return 0; }
}

/** Batch upsert channels by username_or_link — far faster than one-by-one for large imports. */
export async function batchUpsertTelegramChannels(
  channels: Array<Partial<TelegramChannel>>,
): Promise<{ inserted: number; errors: number }> {
  if (!isSupabaseConfigured) return { inserted: 0, errors: 0 };
  const db = getDb(); if (!db) return { inserted: 0, errors: 0 };

  const now = new Date().toISOString();
  const CHUNK = 200; // Supabase upsert limit per request
  let inserted = 0;
  let errors   = 0;

  for (let i = 0; i < channels.length; i += CHUNK) {
    const chunk = channels.slice(i, i + CHUNK).map((ch) => ({
      title:            ch.title ?? '',
      username_or_link: ch.usernameOrLink ?? '',
      type:             ch.type ?? 'channel',
      category:         ch.category ?? null,
      language:         ch.language ?? 'uk',
      status:           ch.status ?? 'active',
      posting_method:   ch.postingMethod ?? 'bot',
      members_count:    ch.membersCount ?? null,
      notes:            ch.notes ?? null,
      created_by:       ch.createdBy ?? null,
      updated_at:       now,
      created_at:       now,
    }));

    try {
      const { error, data } = await db
        .from('telegram_channels')
        .upsert(chunk, { onConflict: 'username_or_link', ignoreDuplicates: false })
        .select('id');
      if (error) { console.error('[db] batchUpsert chunk error:', error.message); errors += chunk.length; }
      else inserted += data?.length ?? chunk.length;
    } catch (e) {
      console.error('[db] batchUpsert exception:', e);
      errors += chunk.length;
    }
  }

  return { inserted, errors };
}

export async function upsertTelegramChannel(ch: Partial<TelegramChannel>): Promise<TelegramChannel | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      title:             ch.title ?? '',
      username_or_link:  ch.usernameOrLink ?? '',
      type:              ch.type ?? 'channel',
      category:          ch.category ?? null,
      language:          ch.language ?? 'uk',
      status:            ch.status ?? 'active',
      posting_method:    ch.postingMethod ?? 'bot',
      members_count:     ch.membersCount ?? null,
      notes:             ch.notes ?? null,
      created_by:        ch.createdBy ?? null,
      updated_at:        now,
    };
    if (ch.id) {
      const { data, error } = await db.from('telegram_channels').update(payload).eq('id', ch.id).select('*').single();
      if (error) throw error;
      return mapChannel(data);
    } else {
      const { data, error } = await db.from('telegram_channels').insert({ ...payload, created_at: now }).select('*').single();
      if (error) throw error;
      return mapChannel(data);
    }
  } catch (err) { console.error('[db] upsertTelegramChannel error:', err); return null; }
}

export async function deleteTelegramChannel(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.from('telegram_channels').delete().eq('id', id);
  } catch (err) { console.error('[db] deleteTelegramChannel error:', err); }
}

function mapChannel(r: Record<string, unknown>): TelegramChannel {
  return {
    id:             r.id as string,
    title:          r.title as string,
    usernameOrLink: r.username_or_link as string,
    type:           (r.type as TelegramChannel['type']) ?? 'channel',
    category:       r.category as string | undefined,
    language:       (r.language as string) ?? 'uk',
    status:         (r.status as TelegramChannel['status']) ?? 'active',
    postingMethod:  (r.posting_method as TelegramChannel['postingMethod']) ?? 'bot',
    membersCount:   r.members_count as number | undefined,
    notes:          r.notes as string | undefined,
    createdBy:      r.created_by as string | undefined,
    createdAt:      r.created_at as string,
    updatedAt:      r.updated_at as string,
  };
}

// ─── SaaS: Campaigns ─────────────────────────────────────────────────────────

export async function getCampaigns(userId: string, limit = 50): Promise<Campaign[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    const { data } = await db.from('campaigns').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    return (data ?? []).map(mapCampaign);
  } catch (err) { console.error('[db] getCampaigns error:', err); return []; }
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const { data } = await db.from('campaigns').select('*').eq('id', id).maybeSingle();
    return data ? mapCampaign(data) : null;
  } catch (err) { console.error('[db] getCampaignById error:', err); return null; }
}

export async function createCampaign(c: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'sentCount' | 'failedCount' | 'totalCount'>): Promise<Campaign | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const { data, error } = await db.from('campaigns').insert({
      user_id:            c.userId,
      title:              c.title,
      message_text:       c.messageText,
      media_url:          c.mediaUrl ?? null,
      target_channel_ids: c.targetChannelIds,
      status:             c.status ?? 'draft',
      schedule_type:      c.scheduleType ?? 'now',
      scheduled_at:       c.scheduledAt ?? null,
      delay_min_seconds:  c.delayMinSeconds ?? 3,
      delay_max_seconds:  c.delayMaxSeconds ?? 10,
      sent_count:         0,
      failed_count:       0,
      total_count:        c.targetChannelIds.length,
      created_at:         now,
      updated_at:         now,
    }).select('*').single();
    if (error) throw error;
    return mapCampaign(data);
  } catch (err) { console.error('[db] createCampaign error:', err); return null; }
}

export async function updateCampaignStatus(id: string, status: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.from('campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  } catch (err) { console.error('[db] updateCampaignStatus error:', err); }
}

export async function getCampaignMessages(campaignId: string): Promise<CampaignMessage[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    const { data } = await db.from('campaign_messages').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true });
    return (data ?? []).map(mapCampaignMessage);
  } catch (err) { console.error('[db] getCampaignMessages error:', err); return []; }
}

function mapCampaign(r: Record<string, unknown>): Campaign {
  return {
    id:               r.id as string,
    userId:           r.user_id as string,
    title:            r.title as string,
    messageText:      r.message_text as string,
    mediaUrl:         r.media_url as string | undefined,
    targetChannelIds: (r.target_channel_ids as string[]) ?? [],
    status:           (r.status as Campaign['status']) ?? 'draft',
    scheduleType:     (r.schedule_type as Campaign['scheduleType']) ?? 'now',
    scheduledAt:      r.scheduled_at as string | undefined,
    delayMinSeconds:  (r.delay_min_seconds as number) ?? 3,
    delayMaxSeconds:  (r.delay_max_seconds as number) ?? 10,
    sentCount:        (r.sent_count as number) ?? 0,
    failedCount:      (r.failed_count as number) ?? 0,
    totalCount:       (r.total_count as number) ?? 0,
    createdAt:        r.created_at as string,
    updatedAt:        r.updated_at as string,
  };
}

function mapCampaignMessage(r: Record<string, unknown>): CampaignMessage {
  return {
    id:           r.id as string,
    campaignId:   r.campaign_id as string,
    channelId:    r.channel_id as string,
    status:       (r.status as CampaignMessage['status']) ?? 'pending',
    errorReason:  r.error_reason as string | undefined,
    sentAt:       r.sent_at as string | undefined,
    createdAt:    r.created_at as string,
  };
}

// ─── SaaS: Dashboard Stats ────────────────────────────────────────────────────

export async function getSaaSDashboardStats(userId: string): Promise<SaaSDashboardStats> {
  const fallback: SaaSDashboardStats = {
    sentTotal: 0, sentToday: 0, sentUnconfirmed: 0, failed: 0, skipped: 0,
    applicationsThisMonth: 0, monthlyLimit: 20, isWorkerRunning: false, accountStatus: null,
  };
  if (!isSupabaseConfigured) return fallback;
  try {
    const db = getDb(); if (!db) return fallback;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const [appsRes, acctRes, userRes, filterRes] = await Promise.all([
      db.from('applications').select('status, created_at, sent_at').eq('user_id', userId),
      db.from('freelance_accounts').select('status').eq('user_id', userId).maybeSingle(),
      db.from('users').select('applications_this_month, subscription_plan').eq('id', userId).maybeSingle(),
      db.from('freelance_filters').select('is_enabled').eq('user_id', userId).maybeSingle(),
    ]);

    const apps = appsRes.data ?? [];
    const sentTotal       = apps.filter((a: Record<string,string>) => a.status === 'sent' || a.status === 'sent_unconfirmed').length;
    const sentToday       = apps.filter((a: Record<string,string>) => (a.status === 'sent' || a.status === 'sent_unconfirmed') && new Date(a.sent_at ?? a.created_at) >= today).length;
    const sentUnconfirmed = apps.filter((a: Record<string,string>) => a.status === 'sent_unconfirmed').length;
    const failed          = apps.filter((a: Record<string,string>) => a.status === 'failed').length;
    const skipped         = apps.filter((a: Record<string,string>) => a.status === 'skipped').length;
    const thisMonth       = apps.filter((a: Record<string,string>) => new Date(a.created_at) >= new Date(startOfMonth)).length;

    const plan = (userRes.data?.subscription_plan ?? 'free') as string;
    const limits: Record<string, number> = { free: 20, pro: 300, agency: 999 };
    const monthlyLimit = limits[plan] ?? 20;
    const isWorkerRunning = Boolean(filterRes.data?.is_enabled);

    return {
      sentTotal, sentToday, sentUnconfirmed, failed, skipped,
      applicationsThisMonth: thisMonth,
      monthlyLimit,
      isWorkerRunning,
      accountStatus: (acctRes.data?.status as SaaSDashboardStats['accountStatus']) ?? null,
    };
  } catch (err) { console.error('[db] getSaaSDashboardStats error:', err); return fallback; }
}

// ─── Payment Settings ─────────────────────────────────────────────────────────

function mapPaymentSetting(r: Record<string, unknown>): PaymentSetting {
  return {
    id:           r.id as string,
    methodName:   r.method_name as string,
    address:      r.address as string,
    instructions: r.instructions as string,
    currency:     r.currency as PaymentSetting['currency'],
    isActive:     Boolean(r.is_active),
    createdBy:    r.created_by as string,
    createdAt:    r.created_at as string,
    updatedAt:    r.updated_at as string,
  };
}

export async function getPaymentSettings(onlyActive = false): Promise<PaymentSetting[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    let q = db.from('payment_settings').select('*').order('created_at', { ascending: true });
    if (onlyActive) q = q.eq('is_active', true);
    const { data } = await q;
    return (data ?? []).map(mapPaymentSetting);
  } catch (err) { console.error('[db] getPaymentSettings error:', err); return []; }
}

export async function upsertPaymentSetting(s: Partial<PaymentSetting> & { createdBy: string }): Promise<PaymentSetting | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    if (s.id) {
      const { data, error } = await db.from('payment_settings').update({
        method_name: s.methodName, address: s.address, instructions: s.instructions,
        currency: s.currency, is_active: s.isActive, updated_at: now,
      }).eq('id', s.id).select('*').single();
      if (error) throw error;
      return mapPaymentSetting(data);
    } else {
      const { data, error } = await db.from('payment_settings').insert({
        method_name: s.methodName, address: s.address, instructions: s.instructions,
        currency: s.currency ?? 'UAH', is_active: s.isActive ?? true,
        created_by: s.createdBy, created_at: now, updated_at: now,
      }).select('*').single();
      if (error) throw error;
      return mapPaymentSetting(data);
    }
  } catch (err) { console.error('[db] upsertPaymentSetting error:', err); return null; }
}

export async function deletePaymentSetting(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const db = getDb(); if (!db) return;
    await db.from('payment_settings').delete().eq('id', id);
  } catch (err) { console.error('[db] deletePaymentSetting error:', err); }
}

// ─── Manual Payments ──────────────────────────────────────────────────────────

function mapManualPayment(r: Record<string, unknown>): ManualPayment {
  return {
    id:                r.id as string,
    userId:            r.user_id as string,
    userName:          r.user_name as string | undefined,
    userUsername:      r.user_username as string | undefined,
    paymentSettingId:  r.payment_setting_id as string | undefined,
    methodName:        r.method_name as string | undefined,
    amount:            r.amount as number | undefined,
    currency:          r.currency as string | undefined,
    transactionId:     r.transaction_id as string | undefined,
    proofNote:         r.proof_note as string | undefined,
    plan:              r.plan as ManualPaymentPlan,
    status:            r.status as ManualPayment['status'],
    reviewedBy:        r.reviewed_by as string | undefined,
    reviewedAt:        r.reviewed_at as string | undefined,
    createdAt:         r.created_at as string,
    updatedAt:         r.updated_at as string,
  };
}

export async function createManualPayment(p: Omit<ManualPayment, 'id' | 'status' | 'reviewedBy' | 'reviewedAt' | 'createdAt' | 'updatedAt'>): Promise<ManualPayment | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const { data, error } = await db.from('manual_payments').insert({
      user_id: p.userId, user_name: p.userName ?? null, user_username: p.userUsername ?? null,
      payment_setting_id: p.paymentSettingId ?? null, method_name: p.methodName ?? null,
      amount: p.amount ?? null, currency: p.currency ?? null,
      transaction_id: p.transactionId ?? null, proof_note: p.proofNote ?? null,
      plan: p.plan, status: 'pending', created_at: now, updated_at: now,
    }).select('*').single();
    if (error) throw error;
    return mapManualPayment(data);
  } catch (err) { console.error('[db] createManualPayment error:', err); return null; }
}

export async function getManualPayments(options?: { status?: string; userId?: string; limit?: number }): Promise<ManualPayment[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const db = getDb(); if (!db) return [];
    let q = db.from('manual_payments').select('*').order('created_at', { ascending: false }).limit(options?.limit ?? 100);
    if (options?.status) q = q.eq('status', options.status);
    if (options?.userId) q = q.eq('user_id', options.userId);
    const { data } = await q;
    return (data ?? []).map(mapManualPayment);
  } catch (err) { console.error('[db] getManualPayments error:', err); return []; }
}

export async function reviewManualPayment(id: string, status: 'approved' | 'rejected', reviewedBy: string): Promise<ManualPayment | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const db = getDb(); if (!db) return null;
    const now = new Date().toISOString();
    const { data: payment } = await db.from('manual_payments').select('*').eq('id', id).single();
    if (!payment) return null;

    const { data, error } = await db.from('manual_payments').update({
      status, reviewed_by: reviewedBy, reviewed_at: now, updated_at: now,
    }).eq('id', id).select('*').single();
    if (error) throw error;

    // If approved — upgrade the user subscription
    if (status === 'approved') {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await updateUserPlan(payment.user_id, payment.plan, expiresAt);
    }

    return mapManualPayment(data);
  } catch (err) { console.error('[db] reviewManualPayment error:', err); return null; }
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
