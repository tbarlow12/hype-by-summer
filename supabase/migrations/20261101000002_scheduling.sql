-- Scheduling: session types, per-coach availability, bookings, waitlist.

create table public.session_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Coaches who run this session; a client books one of them (or "any").
  coach_ids uuid[] not null check (cardinality(coach_ids) >= 1),
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
  requires_payment boolean not null default true,
  is_consultation boolean not null default false,             -- free intro call for leads
  clients_only boolean not null default false,                 -- hidden from the public site
  color text not null default '#e11d48',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug)
);
create index on public.session_types using gin (coach_ids);
create trigger session_types_updated before update on public.session_types
  for each row execute function public.set_updated_at();

-- Weekly recurring availability per coach, in the coach's timezone.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  session_type_ids uuid[],                                     -- null = all types
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index on public.availability_rules (business_id, coach_id, weekday);

-- Date-specific overrides: extra hours or time off for one coach, or the whole
-- business when coach_id is null (holidays, gym closures).
create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_available boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (coach_id is not null or not is_available)
);
create index on public.availability_overrides (business_id, coach_id, starts_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete restrict,
  session_type_id uuid not null references public.session_types (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,
  lead_id uuid,                                                -- fk added in leads migration
  guest_name text,
  guest_email citext,
  guest_phone text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_range tstzrange not null,                            -- incl. buffers; conflict checks
  status public.booking_status not null default 'pending_payment',
  payment_method public.payment_method_kind not null default 'stripe',
  price_cents int not null default 0,
  credits_used int not null default 0,
  stripe_checkout_session_id text unique,
  hold_expires_at timestamptz,
  location_type public.location_type not null,
  location_details text,
  video_room_url text,
  client_notes text,
  coach_notes text,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  rescheduled_from uuid references public.bookings (id),
  manage_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  reminders_sent int[] not null default '{}',
  recurrence_group uuid,
  confirmation_sent_at timestamptz,                            -- onBookingConfirmed idempotency
  client_timezone text,
  sms_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (client_id is not null or guest_email is not null)
);
create index on public.bookings (business_id, starts_at);
create index on public.bookings (coach_id, starts_at);
create index on public.bookings (client_id, starts_at);
create index on public.bookings using gist (coach_id, blocked_range);
create index on public.bookings (status, hold_expires_at);
create index on public.bookings (rescheduled_from) where rescheduled_from is not null;
create trigger bookings_updated before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  session_type_id uuid not null references public.session_types (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  client_id uuid references public.profiles (id) on delete cascade,
  email citext not null,
  name text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_type_id, coach_id, starts_at, email)
);
create index on public.waitlist_entries (session_type_id, starts_at) where notified_at is null;

-- Compute blocked_range from times + session type buffers.
create or replace function public.bookings_set_blocked_range() returns trigger
language plpgsql as $$
declare
  v_before int;
  v_after int;
begin
  select buffer_before_minutes, buffer_after_minutes into v_before, v_after
    from public.session_types where id = new.session_type_id;
  new.blocked_range := tstzrange(
    new.starts_at - make_interval(mins => coalesce(v_before, 0)),
    new.ends_at + make_interval(mins => coalesce(v_after, 0)), '[)');
  return new;
end $$;
create trigger bookings_blocked_range
  before insert or update of starts_at, ends_at, session_type_id on public.bookings
  for each row execute function public.bookings_set_blocked_range();

-- Statuses that occupy the calendar.
create or replace function public.booking_is_active(s public.booking_status, hold timestamptz)
returns boolean language sql immutable as $$
  select s in ('confirmed', 'completed', 'no_show')
      or (s = 'pending_payment' and hold is not null and hold > now())
$$;

-- Atomically reserve a slot with one coach. Serialises per coach with an
-- advisory lock, then enforces: the coach runs this session type, no overlap
-- with the coach's other sessions, capacity for group sessions, no overlap
-- with the coach's or the business's time off.
create or replace function public.reserve_booking(
  p_session_type_id uuid,
  p_coach_id uuid,
  p_starts_at timestamptz,
  p_client_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_status public.booking_status,
  p_payment_method public.payment_method_kind,
  p_hold_minutes int,
  p_client_notes text,
  p_lead_id uuid default null,
  p_rescheduled_from uuid default null
) returns public.bookings
language plpgsql security definer set search_path = public, extensions as $$
declare
  st public.session_types;
  v_ends timestamptz;
  v_range tstzrange;
  v_same int;
  b public.bookings;
begin
  select * into st from public.session_types where id = p_session_type_id and active;
  if not found then
    raise exception 'session_type_not_found' using errcode = 'P0002';
  end if;
  if not (p_coach_id = any (st.coach_ids)) or not exists (
    select 1 from public.business_members
     where business_id = st.business_id and user_id = p_coach_id and active
  ) then
    raise exception 'coach_not_available' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_coach_id::text, 0));

  v_ends := p_starts_at + make_interval(mins => st.duration_minutes);
  v_range := tstzrange(
    p_starts_at - make_interval(mins => st.buffer_before_minutes),
    v_ends + make_interval(mins => st.buffer_after_minutes), '[)');

  -- Same group session (type + coach + start) counts toward capacity.
  select count(*) into v_same from public.bookings b2
   where b2.session_type_id = st.id and b2.coach_id = p_coach_id and b2.starts_at = p_starts_at
     and b2.id is distinct from p_rescheduled_from
     and public.booking_is_active(b2.status, b2.hold_expires_at);
  if v_same >= st.capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  if p_client_id is not null and exists (
    select 1 from public.bookings b3
     where b3.session_type_id = st.id and b3.coach_id = p_coach_id and b3.starts_at = p_starts_at
       and b3.client_id = p_client_id
       and public.booking_is_active(b3.status, b3.hold_expires_at)
  ) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bookings b4
     where b4.coach_id = p_coach_id
       and b4.blocked_range && v_range
       and not (b4.session_type_id = st.id and b4.starts_at = p_starts_at)
       and b4.id is distinct from p_rescheduled_from
       and public.booking_is_active(b4.status, b4.hold_expires_at)
  ) then
    raise exception 'slot_conflict' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.availability_overrides o
     where o.business_id = st.business_id and not o.is_available
       and (o.coach_id is null or o.coach_id = p_coach_id)
       and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, v_ends, '[)')
  ) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    business_id, coach_id, session_type_id, client_id, lead_id, guest_name, guest_email, guest_phone,
    starts_at, ends_at, blocked_range, status, payment_method, price_cents,
    hold_expires_at, location_type, location_details, client_notes, rescheduled_from
  ) values (
    st.business_id, p_coach_id, st.id, p_client_id, p_lead_id, p_guest_name, p_guest_email, p_guest_phone,
    p_starts_at, v_ends, v_range, p_status, p_payment_method, st.price_cents,
    case when p_status = 'pending_payment' then now() + make_interval(mins => p_hold_minutes) end,
    st.location_type, st.location_details, p_client_notes, p_rescheduled_from
  ) returning * into b;

  return b;
end $$;

-- Move a confirmed booking to a new time (optionally another coach) in one
-- transaction; carries payment, credits and notes; the old booking is
-- cancelled with cancel_reason = 'rescheduled' (no refund side effects).
create or replace function public.reschedule_booking(
  p_booking uuid,
  p_starts_at timestamptz,
  p_actor uuid default null,
  p_coach_id uuid default null
) returns public.bookings
language plpgsql security definer set search_path = public, extensions as $$
declare
  old public.bookings;
  nb public.bookings;
  v_checkout text;
begin
  select * into old from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if old.status <> 'confirmed' then
    raise exception 'not_reschedulable' using errcode = 'P0001';
  end if;
  if old.starts_at = p_starts_at and coalesce(p_coach_id, old.coach_id) = old.coach_id then
    raise exception 'same_time' using errcode = 'P0001';
  end if;

  nb := public.reserve_booking(
    old.session_type_id, coalesce(p_coach_id, old.coach_id), p_starts_at, old.client_id, old.guest_name,
    old.guest_email, old.guest_phone, 'confirmed', old.payment_method, 0, old.client_notes, old.lead_id, old.id
  );
  v_checkout := old.stripe_checkout_session_id;

  update public.bookings set status = 'cancelled', cancel_reason = 'rescheduled', cancelled_at = now(),
         cancelled_by = p_actor, stripe_checkout_session_id = null
   where id = old.id;

  update public.bookings set
    price_cents = old.price_cents, credits_used = old.credits_used, stripe_checkout_session_id = v_checkout,
    coach_notes = old.coach_notes, recurrence_group = old.recurrence_group,
    client_timezone = old.client_timezone, sms_opt_in = old.sms_opt_in
  where id = nb.id
  returning * into nb;

  update public.payments set booking_id = nb.id where booking_id = old.id;
  update public.credit_ledger set booking_id = nb.id where booking_id = old.id;
  return nb;
end $$;

-- Expire unpaid booking holds (cron).
create or replace function public.expire_booking_holds() returns int
language sql security definer set search_path = public, extensions as $$
  with x as (
    update public.bookings set status = 'cancelled', cancel_reason = 'payment_not_completed', cancelled_at = now()
     where status = 'pending_payment' and hold_expires_at < now()
    returning 1
  ) select count(*)::int from x
$$;
