-- Migration: 001_create_tables.sql
-- Creates tables for the BidPilot auto-bid internal system.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE).

-- ── auto_bid_settings ─────────────────────────────────────────────────────────
-- Single-row table storing the current auto-bid configuration (JSONB).

CREATE TABLE IF NOT EXISTS public.auto_bid_settings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data       JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ensure only one row ever exists
CREATE UNIQUE INDEX IF NOT EXISTS auto_bid_settings_single_row
  ON public.auto_bid_settings ((true));

-- ── auto_bid_logs ─────────────────────────────────────────────────────────────
-- Append-only log of every auto-bid cycle event.

CREATE TABLE IF NOT EXISTS public.auto_bid_logs (
  id            TEXT         PRIMARY KEY,
  level         TEXT         NOT NULL CHECK (level IN ('info', 'success', 'warning', 'error')),
  message       TEXT         NOT NULL,
  project_id    TEXT,
  project_title TEXT,
  bid_id        TEXT,
  meta          JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auto_bid_logs_created_at_idx
  ON public.auto_bid_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS auto_bid_logs_level_idx
  ON public.auto_bid_logs (level);

-- ── bids ──────────────────────────────────────────────────────────────────────
-- Each submitted (or dry-run draft) bid, stored as JSONB.

CREATE TABLE IF NOT EXISTS public.bids (
  id         TEXT         PRIMARY KEY,
  data       JSONB        NOT NULL,
  status     TEXT         NOT NULL GENERATED ALWAYS AS (data->>'status') STORED,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bids_created_at_idx
  ON public.bids (created_at DESC);

CREATE INDEX IF NOT EXISTS bids_status_idx
  ON public.bids (status);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- This is an internal system (no per-user auth), so we allow service-role
-- access only. RLS is enabled but no user-facing policies are needed here.

ALTER TABLE public.auto_bid_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_bid_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids              ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- The anon/authenticated roles should NOT have direct table access
-- since all reads/writes go through server-side API routes using
-- the service role key.
