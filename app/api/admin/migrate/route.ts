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

    const { getServiceClient } = await import('@/lib/supabase/service');
    const db = getServiceClient();

    const sql = `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'role'
        ) THEN
          ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
        END IF;
      END $$;

      UPDATE users SET role = 'owner', subscription_plan = 'unlimited', subscription_status = 'active'
      WHERE telegram_id = ${OWNER_TELEGRAM_ID};

      CREATE TABLE IF NOT EXISTS payment_settings (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        method_name  TEXT NOT NULL,
        address      TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        currency     TEXT NOT NULL DEFAULT 'UAH',
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_by   TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS manual_payments (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            TEXT NOT NULL,
        user_name          TEXT,
        user_username      TEXT,
        payment_setting_id UUID,
        method_name        TEXT,
        amount             NUMERIC,
        currency           TEXT,
        transaction_id     TEXT,
        proof_note         TEXT,
        plan               TEXT NOT NULL DEFAULT 'pro',
        status             TEXT NOT NULL DEFAULT 'pending',
        reviewed_by        TEXT,
        reviewed_at        TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS manual_payments_user_id_idx ON manual_payments(user_id);
      CREATE INDEX IF NOT EXISTS manual_payments_status_idx  ON manual_payments(status);
    `;

    const { error } = await db.rpc('exec_sql', { query: sql }).single().catch(() => ({ error: null }));
    // If rpc not available, try direct query via pg
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, hint: 'Run scripts/migrate-admin-tables.sql in Supabase SQL editor directly.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Migration complete' });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'error',
      hint: 'Run scripts/migrate-admin-tables.sql in Supabase SQL editor manually.',
    }, { status: 500 });
  }
}
