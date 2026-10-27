-- Hype by Summer: core schema
-- Roles: trainers run the business, clients train with them. A single Stripe
-- account (the business) collects every payment.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "btree_gist" with schema extensions;
create extension if not exists "citext" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('trainer', 'client', 'admin');
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
  'captured', 'magnet_delivered', 'magnet_downloaded', 'email_sent', 'note',
  'status_changed', 'consult_booked', 'converted', 'page_view'
);
create type public.message_kind as enum ('text', 'video', 'image', 'file', 'system', 'workout_share');
create type public.notification_channel as enum ('in_app', 'email', 'sms');

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
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
  role public.user_role not null default 'client',
  email citext not null,
  full_name text,
  avatar_url text,
  phone text,
  timezone text not null default 'America/Denver',
  date_of_birth date,
  stripe_customer_id text unique,
  marketing_opt_in boolean not null default false,
  sms_opt_in boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles (role);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Public-facing trainer settings (the "Calendly page").
create table public.trainer_profiles (
  trainer_id uuid primary key references public.profiles (id) on delete cascade,
  slug citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  business_name text not null,
  headline text,
  bio text,
  specialties text[] not null default '{}',
  certifications text[] not null default '{}',
  instagram_handle text,
  website_url text,
  brand_color text not null default '#e11d48',
  cover_image_url text,
  default_location text,
  -- Policies
  cancellation_window_hours int not null default 24 check (cancellation_window_hours >= 0),
  late_cancel_fee_cents int not null default 0 check (late_cancel_fee_cents >= 0),
  no_show_fee_cents int not null default 0 check (no_show_fee_cents >= 0),
  refund_on_cancel boolean not null default true,
  reminder_hours int[] not null default '{24,2}',
  accepting_new_clients boolean not null default true,
  -- Private ICS feed token (calendar subscription for Google/Apple Calendar).
  calendar_feed_token text not null default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trainer_profiles_updated before update on public.trainer_profiles
  for each row execute function public.set_updated_at();

create table public.trainer_clients (
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status public.relationship_status not null default 'active',
  goals text,
  tags text[] not null default '{}',
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trainer_id, client_id)
);
create index on public.trainer_clients (client_id);
create trigger trainer_clients_updated before update on public.trainer_clients
  for each row execute function public.set_updated_at();

-- Trainer-only notes about a client (session notes, observations).
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.client_notes (trainer_id, client_id, created_at desc);

-- Health/readiness intake (PAR-Q style) and liability waiver.
create table public.client_intakes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
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
  unique (client_id, trainer_id)
);
create trigger client_intakes_updated before update on public.client_intakes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create table public.session_types (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  slug citext not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  name text not null,
  description text,
  duration_minutes int not null check (duration_minutes between 5 and 600),
  price_cents int not null default 0 check (price_cents >= 0),
  currency text not null default 'usd',
  location_type public.location_type not null default 'in_person',
  location_details text,
  capacity int not null default 1 check (capacity >= 1),       -- >1 = group class
  buffer_before_minutes int not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes >= 0),
  min_notice_minutes int not null default 720 check (min_notice_minutes >= 0),
  max_advance_days int not null default 60 check (max_advance_days > 0),
  slot_interval_minutes int not null default 30 check (slot_interval_minutes between 5 and 240),
  credits_required int not null default 1 check (credits_required >= 0),
  allow_credits boolean not null default true,
  requires_payment boolean not null default true,            -- else pay later / free
  is_consultation boolean not null default false,           -- free intro call for leads
  clients_only boolean not null default false,               -- hide from public page
  color text not null default '#e11d48',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainer_id, slug)
);
create trigger session_types_updated before update on public.session_types
  for each row execute function public.set_updated_at();

-- Weekly recurring availability in the trainer's local timezone.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  session_type_ids uuid[],                                     -- null = all types
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index on public.availability_rules (trainer_id, weekday);

-- Date-specific overrides: extra hours (is_available) or time off.
create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_available boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on public.availability_overrides (trainer_id, starts_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  session_type_id uuid not null references public.session_types (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,
  lead_id uuid,                                                -- fk added after leads
  guest_name text,
  guest_email citext,
  guest_phone text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Busy window including buffers; used for conflict detection.
  blocked_range tstzrange not null,
  status public.booking_status not null default 'pending_payment',
  payment_method public.payment_method_kind not null default 'stripe',
  price_cents int not null default 0,
  credits_used int not null default 0,
  stripe_checkout_session_id text unique,
  hold_expires_at timestamptz,                                 -- pending_payment holds
  location_type public.location_type not null,
  location_details text,
  video_room_url text,
  client_notes text,
  trainer_notes text,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  rescheduled_from uuid references public.bookings (id),
  manage_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  reminders_sent int[] not null default '{}',
  recurrence_group uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (client_id is not null or guest_email is not null)
);
create index on public.bookings (trainer_id, starts_at);
create index on public.bookings (client_id, starts_at);
create index on public.bookings using gist (trainer_id, blocked_range);
create index on public.bookings (status, hold_expires_at);
create trigger bookings_updated before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  session_type_id uuid not null references public.session_types (id) on delete cascade,
  starts_at timestamptz not null,
  client_id uuid references public.profiles (id) on delete cascade,
  email citext not null,
  name text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_type_id, starts_at, email)
);

-- ---------------------------------------------------------------------------
-- Commerce
-- ---------------------------------------------------------------------------
create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  kind public.offering_kind not null,
  name text not null,
  description text,
  features text[] not null default '{}',
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'usd',
  billing_interval public.billing_interval,                   -- subscriptions only
  interval_count int not null default 1 check (interval_count >= 1),
  trial_days int not null default 0 check (trial_days >= 0),
  credits int not null default 0 check (credits >= 0),         -- per purchase / period
  credits_expire_days int check (credits_expire_days > 0),
  session_type_ids uuid[],                                     -- credits valid for (null = any)
  includes_messaging boolean not null default true,
  includes_programming boolean not null default false,
  digital_file_path text,                                      -- one_time downloadables
  stripe_product_id text unique,
  stripe_price_id text unique,
  active boolean not null default true,
  featured boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'subscription') = (billing_interval is not null))
);
create trigger offerings_updated before update on public.offerings
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  offering_id uuid references public.offerings (id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null,                                       -- mirrors Stripe status
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.subscriptions (client_id);
create trigger subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  payer_email citext,
  purpose public.payment_purpose not null,
  status public.payment_status not null default 'pending',
  amount_cents int not null,
  amount_refunded_cents int not null default 0,
  currency text not null default 'usd',
  description text,
  booking_id uuid references public.bookings (id) on delete set null,
  offering_id uuid references public.offerings (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text unique,
  stripe_charge_id text,
  receipt_url text,
  hosted_invoice_url text,
  metadata jsonb not null default '{}',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.payments (trainer_id, created_at desc);
create index on public.payments (client_id, created_at desc);
create trigger payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- Session credits (packages + subscription allotments) as a ledger of grants
-- (delta > 0) and debits (delta < 0) that point at the grant they consume.
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null,               -- purchase, subscription_renewal, booking, refund, adjustment, expiry
  offering_id uuid references public.offerings (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  session_type_ids uuid[],            -- grant restriction (null = any)
  expires_at timestamptz,             -- grants only
  -- For debits: which grant was consumed (FIFO by expiry).
  grant_id uuid references public.credit_ledger (id) on delete set null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.credit_ledger (client_id, trainer_id);
create index on public.credit_ledger (grant_id);
-- One grant per Stripe invoice/payment to keep webhook replays idempotent.
create unique index credit_ledger_payment_grant on public.credit_ledger (payment_id)
  where delta > 0 and payment_id is not null;

-- Processed Stripe webhook events (idempotency + audit).
create table public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leads & lead magnets
-- ---------------------------------------------------------------------------
create table public.lead_magnets (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  slug citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title text not null,
  subtitle text,
  description text,
  bullet_points text[] not null default '{}',
  file_path text,                     -- storage: lead-magnets bucket
  cover_image_url text,
  cta_label text not null default 'Send me the free guide',
  thank_you_message text,
  -- Optional qualifying questions shown on the form (keys of leads columns).
  ask_phone boolean not null default false,
  ask_goal boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lead_magnets_updated before update on public.lead_magnets
  for each row execute function public.set_updated_at();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  email citext not null,
  first_name text,
  last_name text,
  phone text,
  status public.lead_status not null default 'new',
  -- Qualification
  primary_goal text,                  -- e.g. lose_fat, build_muscle, strength, event_prep, postpartum, general_health
  goal_details text,
  experience_level text,              -- beginner | intermediate | advanced
  preferred_format text,              -- in_person | virtual | hybrid | app_only
  preferred_days text[] not null default '{}',
  preferred_times text[] not null default '{}',
  budget_range text,
  timeline text,                      -- asap | 1_month | 3_months | exploring
  zip_code text,
  city text,
  injuries_or_limitations text,
  how_heard text,
  -- Attribution
  source text,                        -- lead_magnet | booking | contact_form | referral | manual | import
  lead_magnet_id uuid references public.lead_magnets (id) on delete set null,
  referred_by_client_id uuid references public.profiles (id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer_url text,
  landing_page text,
  first_seen_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  country text,
  -- Consent & engagement
  marketing_consent boolean not null default false,
  consent_text text,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  score int not null default 0,
  tags text[] not null default '{}',
  notes text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  converted_client_id uuid references public.profiles (id) on delete set null,
  converted_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainer_id, email)
);
create index on public.leads (trainer_id, status, created_at desc);
create index on public.leads (trainer_id, next_follow_up_at) where next_follow_up_at is not null;
create trigger leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.bookings
  add constraint bookings_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete set null;

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type public.lead_event_type not null,
  detail jsonb not null default '{}',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.lead_events (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Training: exercise library, programs, logging, feedback
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references public.profiles (id) on delete cascade,  -- null = global library
  name text not null,
  category text,                      -- strength | cardio | mobility | plyometric | core
  primary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  instructions text,
  coaching_cues text[] not null default '{}',
  demo_video_url text,
  thumbnail_url text,
  is_unilateral boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.exercises (trainer_id, name);
create trigger exercises_updated before update on public.exercises
  for each row execute function public.set_updated_at();

-- client_id null = reusable template; otherwise the client's assigned copy.
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete cascade,
  template_id uuid references public.programs (id) on delete set null,
  name text not null,
  description text,
  goal text,
  duration_weeks int not null default 4 check (duration_weeks between 1 and 104),
  start_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.programs (trainer_id);
create index on public.programs (client_id);
create trigger programs_updated before update on public.programs
  for each row execute function public.set_updated_at();

create table public.program_workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  week int not null check (week >= 1),
  day int not null check (day between 1 and 7),
  name text not null,
  notes text,
  estimated_minutes int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.program_workouts (program_id, week, day);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.program_workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  sort_order int not null default 0,
  superset_group text,                -- e.g. 'A' pairs A1/A2
  sets int not null default 3 check (sets between 1 and 20),
  reps text,                          -- '8-10', 'AMRAP', '30s'
  load text,                          -- '135 lb', '70% 1RM', 'RPE 8'
  rest_seconds int,
  tempo text,
  notes text
);
create index on public.workout_exercises (workout_id, sort_order);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  workout_id uuid references public.program_workouts (id) on delete set null,
  performed_on date not null default current_date,
  duration_minutes int,
  session_rpe numeric(3, 1) check (session_rpe between 1 and 10),
  difficulty_rating smallint check (difficulty_rating between 1 and 5),   -- too easy .. too hard
  enjoyment_rating smallint check (enjoyment_rating between 1 and 5),
  energy_level smallint check (energy_level between 1 and 5),
  pain_flag boolean not null default false,
  feedback text,
  trainer_response text,
  trainer_responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.workout_logs (client_id, performed_on desc);
create trigger workout_logs_updated before update on public.workout_logs
  for each row execute function public.set_updated_at();

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  workout_exercise_id uuid references public.workout_exercises (id) on delete set null,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  set_number int not null,
  reps int,
  weight numeric(7, 2),
  weight_unit text not null default 'lb' check (weight_unit in ('lb', 'kg')),
  duration_seconds int,
  rpe numeric(3, 1),
  completed boolean not null default true,
  notes text
);
create index on public.set_logs (workout_log_id);
create index on public.set_logs (exercise_id);

-- Program-level feedback ("how is this plan working for you?").
create table public.program_feedback (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  week int,
  overall_rating smallint check (overall_rating between 1 and 5),
  difficulty text check (difficulty in ('too_easy', 'just_right', 'too_hard')),
  volume text check (volume in ('too_little', 'just_right', 'too_much')),
  favorite_parts text,
  least_favorite_parts text,
  requested_changes text,
  trainer_response text,
  trainer_responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.program_feedback (program_id);

-- Weekly check-ins.
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  week_of date not null,
  body_weight numeric(6, 2),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  stress_level smallint check (stress_level between 1 and 5),
  energy_level smallint check (energy_level between 1 and 5),
  nutrition_adherence smallint check (nutrition_adherence between 1 and 5),
  training_adherence smallint check (training_adherence between 1 and 5),
  wins text,
  struggles text,
  questions text,
  trainer_response text,
  trainer_responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, trainer_id, week_of)
);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  measured_on date not null default current_date,
  weight numeric(6, 2),
  body_fat_pct numeric(4, 1),
  waist numeric(5, 1),
  hips numeric(5, 1),
  chest numeric(5, 1),
  arm numeric(5, 1),
  thigh numeric(5, 1),
  resting_hr int,
  unit_system text not null default 'imperial' check (unit_system in ('imperial', 'metric')),
  notes text,
  created_at timestamptz not null default now()
);
create index on public.body_metrics (client_id, measured_on desc);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  taken_on date not null default current_date,
  pose text check (pose in ('front', 'side', 'back', 'other')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid references public.profiles (id) on delete set null,
  title text not null,
  metric text,
  target_value numeric,
  current_value numeric,
  unit text,
  target_date date,
  achieved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid references public.profiles (id) on delete set null,
  name text not null,                 -- "Drink 100 oz water", "8k steps"
  target_per_week int not null default 7 check (target_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.habit_logs (
  habit_id uuid not null references public.habits (id) on delete cascade,
  logged_on date not null,
  primary key (habit_id, logged_on)
);

-- ---------------------------------------------------------------------------
-- Communication: chat, form-check videos, notifications, broadcasts
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz,
  trainer_last_read_at timestamptz,
  client_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trainer_id, client_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text,
  attachment_path text,               -- storage: chat-media bucket
  attachment_mime text,
  video_submission_id uuid,
  workout_log_id uuid references public.workout_logs (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null or kind = 'system')
);
create index on public.messages (conversation_id, created_at);

-- Form-check videos with timestamped coaching comments.
create table public.video_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  title text not null,
  client_note text,
  storage_path text not null,         -- storage: form-videos bucket
  mime_type text,
  duration_seconds numeric,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'reviewed', 'archived')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.video_submissions (trainer_id, status, created_at desc);
create index on public.video_submissions (client_id, created_at desc);

alter table public.messages
  add constraint messages_video_submission_fkey foreign key (video_submission_id)
  references public.video_submissions (id) on delete set null;

create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.video_submissions (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  timestamp_seconds numeric,          -- null = general comment
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.video_comments (submission_id, timestamp_seconds);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  audience text not null default 'active_clients'
    check (audience in ('active_clients', 'all_clients', 'leads', 'subscribers')),
  subject text not null,
  body text not null,
  channels public.notification_channel[] not null default '{in_app,email}',
  recipient_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  rating smallint check (rating between 1 and 5),
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
