-- Growth/loyalty/referral/NPS tables for ZenithMoto
-- Apply via Supabase SQL editor (project: edcvmgpcllhszxvthdzx)

-- 1. Loyalty points
create table if not exists public.loyalty_points (
  customer_id text primary key,           -- client email
  points integer not null default 0,
  level text not null default 'bronze',   -- 'bronze' | 'silver' | 'gold'
  updated_at timestamptz default now()
);
create index if not exists idx_loyalty_level on public.loyalty_points(level);

-- 2. Referrals
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_email text not null,
  referee_email text not null,
  status text not null default 'pending', -- 'pending' | 'rewarded' | 'expired'
  reward_issued boolean not null default false,
  coupon_code text,
  created_at timestamptz default now(),
  rewarded_at timestamptz
);
create index if not exists idx_ref_referee on public.referrals(referee_email, status);
create index if not exists idx_ref_referrer on public.referrals(referrer_email);

-- 3. NPS post-rental
create table if not exists public.rental_nps (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null,
  score integer not null check (score >= 0 and score <= 10),
  comment text,
  created_at timestamptz default now()
);
create index if not exists idx_nps_booking on public.rental_nps(booking_id);
create index if not exists idx_nps_score on public.rental_nps(score);

-- 4. bookings flags (idempotent)
alter table public.bookings add column if not exists loyalty_awarded boolean default null;
alter table public.bookings add column if not exists nps_sent boolean default null;
