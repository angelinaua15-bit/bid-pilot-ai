/**
 * POST /api/admin/migrate
 * One-time migration: creates payment_settings + manual_payments tables.
 * Only callable by the owner account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { OWNER_TELEGRAM_ID } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const { requesterId } = await req.json();
    const user = await assertAdmin(requesterId);
    if (!user || user.role !== 'owner') {
      return NextResponse.json({ ok: false, error: 'Forbidden — owner only' }, { status: 403 });
    }

    // Migrations are applied directly in Supabase SQL editor.
    // This endpoint now just upgrades the owner account row.
    const { getServiceClient } = await import('@/lib/supabase/service');
    const db = getServiceClient();
    if (!db) return NextResponse.json({ ok: false, error: 'DB not configured' }, { status: 500 });

    const { error } = await db.from('users')
      .update({ role: 'owner', subscription_plan: 'unlimited', subscription_status: 'active' })
      .eq('telegram_id', String(OWNER_TELEGRAM_ID));

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Owner account upgraded. DB tables already exist.' });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'error',
      hint: 'Run scripts/migrate-admin-tables.sql in Supabase SQL editor manually.',
    }, { status: 500 });
  }
}
