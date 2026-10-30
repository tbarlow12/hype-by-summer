-- Multi-trainer platform: each trainer_profiles row is a tenant (a trainer's
-- white-labeled business) reachable at <slug>.<platform domain> or its own
-- custom domain, paid through its own Stripe Connect account.

alter table public.trainer_profiles
  add column custom_domain citext unique
    check (custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  add column domain_verified_at timestamptz,
  add column logo_url text,
  add column font_preset text not null default 'athletic'
    check (font_preset in ('athletic', 'modern', 'classic', 'rounded')),
  add column support_email citext,
  -- Platform plan: 'starter' = no monthly fee, platform keeps platform_fee_bps
  -- of each payment; 'pro' = flat monthly subscription, no platform cut.
  add column plan text not null default 'starter' check (plan in ('starter', 'pro')),
  add column platform_fee_bps int not null default 300 check (platform_fee_bps between 0 and 3000),
  add column platform_subscription_id text unique,
  add column platform_subscription_status text,
  add column platform_customer_id text unique,
  -- Stripe Connect (the trainer's own account; charges are created on it).
  add column stripe_account_id text unique,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column status text not null default 'active' check (status in ('active', 'suspended'));

-- Slugs double as subdomains: keep platform hostnames out of the namespace.
alter table public.trainer_profiles add constraint trainer_profiles_slug_not_reserved
  check (slug not in ('www', 'app', 'api', 'admin', 'auth', 'mail', 'help', 'support', 'status',
                      'docs', 'blog', 'billing', 'dashboard', 'login', 'signup', 'static', 'assets', 'cdn'));

-- Trainers may edit their storefront and branding, never plan/billing/Connect
-- fields (those are written by the server with the service role).
revoke insert, update on public.trainer_profiles from authenticated;
grant insert (trainer_id, slug, business_name, headline, bio, specialties, certifications,
  instagram_handle, website_url, brand_color, cover_image_url, default_location,
  cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents, refund_on_cancel,
  reminder_hours, accepting_new_clients, logo_url, font_preset, support_email)
  on public.trainer_profiles to authenticated;
grant update (slug, business_name, headline, bio, specialties, certifications,
  instagram_handle, website_url, brand_color, cover_image_url, default_location,
  cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents, refund_on_cancel,
  reminder_hours, accepting_new_clients, logo_url, font_preset, support_email)
  on public.trainer_profiles to authenticated;

-- Branding is public (it styles the trainer's site for visitors).
grant select (logo_url, font_preset, custom_domain, support_email) on public.trainer_profiles to anon, authenticated;

-- A client can belong to several trainers' businesses, so Stripe customers are
-- per connected account rather than one per person.
create table public.stripe_customers (
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  stripe_account_id text not null,
  customer_id text not null,
  created_at timestamptz not null default now(),
  primary key (trainer_id, profile_id),
  unique (stripe_account_id, customer_id)
);
alter table public.stripe_customers enable row level security;  -- service role only

-- Platform fees earned (application fees on Starter-plan payments).
create table public.platform_fees (
  id text primary key,                      -- Stripe application fee id
  trainer_id uuid references public.profiles (id) on delete set null,
  stripe_account_id text not null,
  amount_cents int not null,
  amount_refunded_cents int not null default 0,
  currency text not null default 'usd',
  charge_id text,
  created_at timestamptz not null default now()
);
create index on public.platform_fees (trainer_id, created_at desc);
alter table public.platform_fees enable row level security;  -- service role only
