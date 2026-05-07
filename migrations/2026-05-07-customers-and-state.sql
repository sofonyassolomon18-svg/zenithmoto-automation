-- Migration 2026-05-07 : retention V1 — customers + automations_state
-- Projet Supabase : edcvmgpcllhszxvthdzx (automation/admin ZenithMoto)
-- NB : total_spent (NUMERIC) aligné sur le champ utilisé dans retention.js (notifyVipOnNewBooking)

-- Table customers : tracking VIP + repeat customers
CREATE TABLE IF NOT EXISTS public.customers (
  email              TEXT PRIMARY KEY,
  name               TEXT,
  rental_count       INT NOT NULL DEFAULT 0,
  total_spent        NUMERIC(10,2) DEFAULT 0,
  is_vip             BOOLEAN NOT NULL DEFAULT false,
  loyalty_tier       TEXT CHECK (loyalty_tier IN ('silver','gold','platinum')) DEFAULT NULL,
  first_booking_at   TIMESTAMPTZ,
  last_booking_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_is_vip ON public.customers(is_vip) WHERE is_vip = true;
CREATE INDEX IF NOT EXISTS idx_customers_last_booking ON public.customers(last_booking_at DESC);

-- Trigger updated_at (fonction partagée)
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_updated_at ON public.customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Table automations_state : side-state idempotence (Option B)
-- Remplace la colonne bookings.recovery_email_sent qui est dans le projet Lovable inaccessible.
-- scope = 'recovery_email_sent' | key = booking_id | value = { sent_at, email }
CREATE TABLE IF NOT EXISTS public.automations_state (
  scope       TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_automations_state_scope_updated
  ON public.automations_state(scope, updated_at DESC);

DROP TRIGGER IF EXISTS automations_state_updated_at ON public.automations_state;
CREATE TRIGGER automations_state_updated_at
  BEFORE UPDATE ON public.automations_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS — accès service_role uniquement (bypass automatique), anon/authenticated bloqués
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations_state ENABLE ROW LEVEL SECURITY;
