-- Foundation: people, businesses (tenants), memberships and client relationships.
--
-- Model
--   profiles           one per auth user (a person; may coach at one business and train at another)
--   businesses         a trainer's or studio's white-labeled business = the tenant
--   business_members   staff of a business with a role (owner, admin, coach, staff)
--   business_clients   a person's relationship with a business as its client
-- Every business-owned row carries business_id; RLS isolates businesses from
-- each other and lets clients see only their own rows.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "btree_gist" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'coach', 'staff');
create type public.relationship_status as enum ('invited', 'active', 'paused', 'archived');
create type public.location_type as enum ('in_person', 'virtual', 'phone', 'client_location');
create type public.booking_status as enum (
  'pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show', 'late_cancelled'
);
create type public.payment_method_kind as enum ('free', 'stripe', 'credits', 'subscription', 'pay_later');
create type public.offering_kind as enum ('package', 'subscription', 'one_time');
create type public.billing_interval as enum ('week', 'month', 'year');
create type public.payment_status as enum (
  'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'cancelled'
);
create type public.payment_purpose as enum (
  'booking', 'package', 'subscription', 'one_time', 'invoice', 'fee', 'tip'
);
create type public.lead_status as enum (
  'new', 'contacted', 'consult_booked', 'nurturing', 'converted', 'lost', 'unsubscribed'
);
create type public.lead_event_type as enum (
  'captured', 'magnet_delivered', 'magnet_downloaded', 'email_sent', 'note', 'status_changed',
  'consult_booked', 'converted', 'page_view', 'invited', 'unsubscribed', 'contact_message'
);
create type public.message_kind as enum ('text', 'video', 'image', 'file', 'system', 'workout_share');
create type public.notification_channel as enum ('in_app', 'email', 'sms');

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null,
  full_name text,
  avatar_url text,
  phone text,
  timezone text not null default 'America/Denver',
  date_of_birth date,
  marketing_opt_in boolean not null default false,
  sms_opt_in boolean not null default false,
  is_platform_admin boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles (email);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Businesses (tenants)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  -- Address: <slug>.<platform domain>, or a verified custom domain.
  slug citext not null unique check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'
    and slug not in ('www', 'app', 'api', 'admin', 'auth', 'mail', 'help', 'support', 'status', 'docs',
                     'blog', 'billing', 'dashboard', 'login', 'signup', 'static', 'assets', 'cdn')),
  custom_domain citext unique check (custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  domain_verified_at timestamptz,
  -- Brand
  name text not null,
  headline text,
  bio text,
  specialties text[] not null default '{}',
  certifications text[] not null default '{}',
  instagram_handle text,
  website_url text,
  brand_color text not null default '#e11d48' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text,
  cover_image_url text,
  font_preset text not null default 'athletic' check (font_preset in ('athletic', 'modern', 'classic', 'rounded')),
  default_location text,
  support_email citext,
  timezone text not null default 'America/Denver',
  -- Policies
  cancellation_window_hours int not null default 24 check (cancellation_window_hours >= 0),
  late_cancel_fee_cents int not null default 0 check (late_cancel_fee_cents >= 0),
  no_show_fee_cents int not null default 0 check (no_show_fee_cents >= 0),
  refund_on_cancel boolean not null default true,
  reminder_hours int[] not null default '{24,2}',
  accepting_new_clients boolean not null default true,
  -- Platform plan: 'starter' = no monthly fee, the platform keeps
  -- platform_fee_bps of each payment; 'pro' = flat monthly fee, no cut.
  plan text not null default 'starter' check (plan in ('starter', 'pro')),
  platform_fee_bps int not null default 300 check (platform_fee_bps between 0 and 3000),
  platform_customer_id text unique,
  platform_subscription_id text unique,
  platform_subscription_status text,
  -- Stripe Connect: the business's own account; charges are created on it.
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'coach',
  -- Public coach profile within this business.
  slug citext check (slug ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  title text,
  bio text,
  specialties text[] not null default '{}',
  is_bookable boolean not null default true,
  -- Private calendar subscription (ICS) for this coach's sessions.
  calendar_feed_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  active boolean not null default true,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id),
  unique (business_id, slug)
);
create index on public.business_members (user_id);
create trigger business_members_updated before update on public.business_members
  for each row execute function public.set_updated_at();

create table public.business_clients (
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status public.relationship_status not null default 'active',
  primary_coach_id uuid references public.profiles (id) on delete set null,
  goals text,
  tags text[] not null default '{}',
  stripe_customer_id text,      -- on the business's connected account
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, client_id)
);
create index on public.business_clients (client_id);
create index on public.business_clients (business_id, primary_coach_id);
create trigger business_clients_updated before update on public.business_clients
  for each row execute function public.set_updated_at();

-- Staff-only notes about a client.
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  booking_id uuid,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.client_notes (business_id, client_id, created_at desc);

-- Health/readiness intake (PAR-Q style) and liability waiver, per business.
create table public.client_intakes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  answers jsonb not null default '{}',
  injuries text,
  medications text,
  experience_level text,
  primary_goal text,
  emergency_contact_name text,
  emergency_contact_phone text,
  waiver_accepted_at timestamptz,
  waiver_signature text,
  waiver_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, client_id)
);
create trigger client_intakes_updated before update on public.client_intakes
  for each row execute function public.set_updated_at();

-- The waiver acceptance time is stamped by the database: (re)signing records
-- now(); clearing the signature clears acceptance.
create or replace function public.client_intakes_stamp_waiver() returns trigger
language plpgsql as $$
begin
  if new.waiver_signature is null or btrim(new.waiver_signature) = '' then
    new.waiver_signature := null;
    new.waiver_accepted_at := null;
    new.waiver_version := null;
  elsif tg_op = 'INSERT'
     or new.waiver_signature is distinct from old.waiver_signature
     or new.waiver_version is distinct from old.waiver_version then
    new.waiver_accepted_at := now();
  else
    new.waiver_accepted_at := old.waiver_accepted_at;
  end if;
  return new;
end $$;
create trigger client_intakes_waiver before insert or update on public.client_intakes
  for each row execute function public.client_intakes_stamp_waiver();

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so RLS policies can call them cheaply)
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false)
$$;

/* Any active staff member of the business (owner, admin, coach, staff). */
create or replace function public.is_member(p_business uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.business_members
                  where business_id = p_business and user_id = auth.uid() and active)
$$;

/* Active member with one of the given roles. */
create or replace function public.has_role(p_business uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.business_members
                  where business_id = p_business and user_id = auth.uid() and active and role = any (p_roles))
$$;

/* Owners and admins manage settings, billing, team and payouts. */
create or replace function public.can_manage(p_business uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.has_role(p_business, array['owner', 'admin']::public.member_role[])
$$;

/* The caller is a (non-archived) client of the business. */
create or replace function public.is_client_of(p_business uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.business_clients
                  where business_id = p_business and client_id = auth.uid() and status <> 'archived')
$$;

/* The caller is staff at some business this person is a client of. */
create or replace function public.is_staff_for_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.business_clients bc
      join public.business_members m on m.business_id = bc.business_id
     where bc.client_id = p_client and m.user_id = auth.uid() and m.active)
$$;

/* The caller shares a business with this person (as staff or client). */
create or replace function public.shares_business_with(p_person uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.business_members m
     where m.user_id = p_person and m.active
       and (public.is_member(m.business_id) or public.is_client_of(m.business_id)))
  or public.is_staff_for_client(p_person)
$$;

-- ---------------------------------------------------------------------------
-- Signup + business creation
-- ---------------------------------------------------------------------------
-- New auth user -> profile. Roles come from memberships, never from signup data.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create a business owned by the caller (trainer signup). Atomic: business +
-- owner membership. Platform fields keep their defaults.
create or replace function public.create_business(p_slug text, p_name text, p_timezone text)
returns public.businesses
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  insert into public.businesses (slug, name, timezone, created_by, support_email)
  values (lower(p_slug), p_name, coalesce(nullif(p_timezone, ''), 'America/Denver'), auth.uid(),
          (select email from public.profiles where id = auth.uid()))
  returning * into b;
  insert into public.business_members (business_id, user_id, role, slug)
  values (b.id, auth.uid(), 'owner', lower(p_slug));
  return b;
end $$;
revoke execute on function public.create_business from public, anon;
grant execute on function public.create_business to authenticated, service_role;
