-- 2026-05-14 — damage_charges: tracks Stripe charges/invoices issued for rental damage
-- under the no-caution policy. Created automatically by chargeDamage().
create table if not exists damage_charges (
  id bigserial primary key,
  booking_id bigint not null,
  amount_chf numeric(10,2) not null,
  reason text default 'rental damage',
  method text not null check (method in ('off_session_pi', 'stripe_invoice', 'manual')),
  payment_intent_id text,
  invoice_id text,
  invoice_item_id text,
  status text not null,
  created_at timestamptz default now()
);
create index if not exists idx_damage_charges_booking on damage_charges(booking_id);
create index if not exists idx_damage_charges_status on damage_charges(status);
