-- Migration : 2026-05-10 — HeyGen renders tracking table
-- Project Supabase : edcvmgpcllhszxvthdzx
-- Apply via : Supabase SQL Editor OU mcp__supabase__apply_migration
--
-- Référencé par :
--   - zenithmoto-automation-v4/server/src/lib/heygen.js
--   - zenithmoto-automation/src/lib/heygen.js
--   - zenithmoto-automation/src/poll-renders.js
--
-- Note FK : booking_id réfère à la table `bookings` du Lovable site (Supabase).
-- Si bookings n'existe pas dans ce project Supabase, retire la FK
-- (les bookings v4 sont en SQLite local et trackés via social_post_meta.booking_id_local).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS heygen_renders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  heygen_video_id TEXT UNIQUE NOT NULL,
  use_case TEXT NOT NULL CHECK (use_case IN ('booking_confirmation', 'social_post')),
  booking_id UUID, -- nullable; FK ajouté conditionnellement plus bas
  social_post_meta JSONB,
  script TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  video_url TEXT,
  gif_url TEXT,
  thumbnail_url TEXT,
  duration_sec NUMERIC,
  credits_used NUMERIC,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_heygen_status ON heygen_renders(status);
CREATE INDEX IF NOT EXISTS idx_heygen_booking ON heygen_renders(booking_id);
CREATE INDEX IF NOT EXISTS idx_heygen_use_case ON heygen_renders(use_case);
CREATE INDEX IF NOT EXISTS idx_heygen_created ON heygen_renders(created_at DESC);

-- Add FK to bookings only if the table exists in this project
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bookings') THEN
    -- Drop existing FK if any (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name='heygen_renders_booking_id_fkey' AND table_name='heygen_renders'
    ) THEN
      ALTER TABLE heygen_renders
        ADD CONSTRAINT heygen_renders_booking_id_fkey
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- RLS : autoriser service_role (default) — bloquer anon
ALTER TABLE heygen_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS heygen_renders_service_all ON heygen_renders;
CREATE POLICY heygen_renders_service_all ON heygen_renders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Optionnel : vue pour le dashboard
DROP VIEW IF EXISTS v_heygen_recent;
CREATE VIEW v_heygen_recent AS
SELECT
  id, heygen_video_id, use_case, status,
  COALESCE(social_post_meta->>'customer_email', social_post_meta->>'platform') AS context,
  duration_sec, credits_used,
  created_at, completed_at, delivered_at,
  EXTRACT(EPOCH FROM (completed_at - created_at)) AS render_time_sec
FROM heygen_renders
ORDER BY created_at DESC
LIMIT 100;
