-- Migration: admin role system + payment tables
-- Run this in your Supabase SQL editor

-- 1. Add 'owner' to the role enum if it exists, else just update the column default
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
  END IF;
END $$;

-- 2. Ensure subscription_plan supports 'unlimited'
-- (it's TEXT so no enum migration needed — just works)

-- 3. Force owner account on login (handled in application code via OWNER_TELEGRAM_ID)
-- But also set it directly in DB for safety:
UPDATE users
SET role = 'owner', subscription_plan = 'unlimited', subscription_status = 'active'
WHERE telegram_id = 6237272293;

-- 4. Create payment_settings table
CREATE TABLE IF NOT EXISTS payment_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_name      TEXT NOT NULL,
  address          TEXT NOT NULL,
  instructions     TEXT NOT NULL DEFAULT '',
  currency         TEXT NOT NULL DEFAULT 'UAH',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Create manual_payments table
CREATE TABLE IF NOT EXISTS manual_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name            TEXT,
  user_username        TEXT,
  payment_setting_id   UUID REFERENCES payment_settings(id) ON DELETE SET NULL,
  method_name          TEXT,
  amount               NUMERIC,
  currency             TEXT,
  transaction_id       TEXT,
  proof_note           TEXT,
  plan                 TEXT NOT NULL DEFAULT 'pro',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by          TEXT,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS manual_payments_user_id_idx   ON manual_payments(user_id);
CREATE INDEX IF NOT EXISTS manual_payments_status_idx    ON manual_payments(status);
CREATE INDEX IF NOT EXISTS payment_settings_active_idx   ON payment_settings(is_active);

-- 7. Row Level Security (disable for service role, which bypasses RLS anyway)
ALTER TABLE payment_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_payments   ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (app uses service role key)
CREATE POLICY IF NOT EXISTS "service_role_payment_settings"  ON payment_settings  USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "service_role_manual_payments"   ON manual_payments   USING (true) WITH CHECK (true);
