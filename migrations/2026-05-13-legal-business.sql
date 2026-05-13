-- 2026-05-13 — Legal & business automation tables for ZenithMoto
-- Apply via Supabase SQL editor.

create table if not exists caution_holds (
  booking_id text primary key,
  payment_intent_id text not null,
  status text not null,                -- 'requires_capture'|'hold_active'|'released'|'captured'|'partial_captured'|'canceled'
  hold_amount numeric(10,2) not null,
  captured_amount numeric(10,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  released_at timestamptz,
  captured_at timestamptz
);
create index if not exists caution_holds_status_idx on caution_holds(status);

create table if not exists licenses (
  booking_id text primary key,
  file_path text not null,
  status text not null default 'pending',  -- 'pending'|'approved'|'rejected'
  uploaded_at timestamptz default now(),
  notified_at timestamptz,
  verified_at timestamptz,
  verifier_note text,
  created_at timestamptz default now()
);
create index if not exists licenses_status_idx on licenses(status);

create table if not exists damage_reports (
  booking_id text primary key,
  photos jsonb default '[]'::jsonb,
  notes text,
  amount_chf numeric(10,2),
  status text default 'flagged',           -- 'flagged'|'auto_flagged'|'resolved'|'dismissed'
  reported_at timestamptz default now()
);

create table if not exists inspections (
  booking_id text not null,
  phase text not null check (phase in ('pre','post')),
  photo_count int default 0,
  mileage int,
  notes text,
  submitted_at timestamptz default now(),
  primary key (booking_id, phase)
);

create table if not exists contracts (
  booking_id text primary key,
  file_path text,
  sign_token text unique not null,
  status text not null default 'pending_signature', -- 'pending_signature'|'signed'|'voided'
  lang text default 'fr',
  signed_at timestamptz,
  signed_ip text,
  signed_ua text,
  created_at timestamptz default now()
);
create index if not exists contracts_token_idx on contracts(sign_token);
