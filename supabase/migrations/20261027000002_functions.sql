-- Helper functions, triggers and transactional RPCs.

-- New auth user -> profile. Role comes from signup metadata only for the very
-- first account (the business owner); everyone else is a client unless
-- promoted by an admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role public.user_role := 'client';
begin
  if not exists (select 1 from public.profiles where role in ('trainer', 'admin')) then
    v_role := 'trainer';
  end if;

  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone',
    v_role
  )
  on conflict (id) do nothing;

  -- Link any existing leads / guest bookings made with this email.
  update public.bookings set client_id = new.id
   where client_id is null and guest_email = new.email;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers (security definer so RLS policies can call them cheaply).
create or replace function public.current_role_is(r public.user_role) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = r)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('trainer', 'admin'))
$$;

create or replace function public.is_trainer_of(p_client uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.trainer_clients
     where trainer_id = auth.uid() and client_id = p_client
  ) or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_client_of(p_trainer uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.trainer_clients
     where client_id = auth.uid() and trainer_id = p_trainer and status <> 'archived'
  )
$$;

-- Program access: trainer who owns it, or the assigned client.
create or replace function public.can_view_program(p_program uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.programs p
     where p.id = p_program
       and (p.trainer_id = auth.uid() or p.client_id = auth.uid()
            or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  )
$$;

create or replace function public.can_view_workout(p_workout uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.program_workouts w
     where w.id = p_workout and public.can_view_program(w.program_id)
  )
$$;

create or replace function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation and auth.uid() in (c.trainer_id, c.client_id)
  )
$$;

-- Keep conversations.last_message_at fresh.
create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.conversations set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end $$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

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
    new.ends_at + make_interval(mins => coalesce(v_after, 0)),
    '[)'
  );
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

-- Atomically reserve a slot. Serialises per trainer with an advisory lock,
-- then enforces: no overlap with other session types, capacity for group
-- sessions, no overlap with blocking overrides.
create or replace function public.reserve_booking(
  p_session_type_id uuid,
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
  v_conflicts int;
  v_blocked int;
  b public.bookings;
begin
  select * into st from public.session_types where id = p_session_type_id and active;
  if not found then
    raise exception 'session_type_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(st.trainer_id::text, 0));

  v_ends := p_starts_at + make_interval(mins => st.duration_minutes);
  v_range := tstzrange(
    p_starts_at - make_interval(mins => st.buffer_before_minutes),
    v_ends + make_interval(mins => st.buffer_after_minutes), '[)');

  -- Same group session (same type + start) counts toward capacity.
  select count(*) into v_same from public.bookings b2
   where b2.session_type_id = st.id and b2.starts_at = p_starts_at
     and b2.id is distinct from p_rescheduled_from
     and public.booking_is_active(b2.status, b2.hold_expires_at);
  if v_same >= st.capacity then
    raise exception 'slot_full' using errcode = 'P0001';
  end if;

  if p_client_id is not null and exists (
    select 1 from public.bookings b3
     where b3.session_type_id = st.id and b3.starts_at = p_starts_at
       and b3.client_id = p_client_id
       and public.booking_is_active(b3.status, b3.hold_expires_at)
  ) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;

  -- Anything else overlapping the window is a conflict.
  select count(*) into v_conflicts from public.bookings b4
   where b4.trainer_id = st.trainer_id
     and b4.blocked_range && v_range
     and not (b4.session_type_id = st.id and b4.starts_at = p_starts_at)
     and b4.id is distinct from p_rescheduled_from
     and public.booking_is_active(b4.status, b4.hold_expires_at);
  if v_conflicts > 0 then
    raise exception 'slot_conflict' using errcode = 'P0001';
  end if;

  select count(*) into v_blocked from public.availability_overrides o
   where o.trainer_id = st.trainer_id and not o.is_available
     and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(p_starts_at, v_ends, '[)');
  if v_blocked > 0 then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    trainer_id, session_type_id, client_id, lead_id, guest_name, guest_email, guest_phone,
    starts_at, ends_at, blocked_range, status, payment_method, price_cents,
    hold_expires_at, location_type, location_details, client_notes, rescheduled_from
  ) values (
    st.trainer_id, st.id, p_client_id, p_lead_id, p_guest_name, p_guest_email, p_guest_phone,
    p_starts_at, v_ends, v_range, p_status, p_payment_method, st.price_cents,
    case when p_status = 'pending_payment' then now() + make_interval(mins => p_hold_minutes) end,
    st.location_type, st.location_details, p_client_notes, p_rescheduled_from
  ) returning * into b;

  return b;
end $$;

-- Credit balance usable for a session type (unexpired grants minus debits).
create or replace function public.credit_balance(
  p_client uuid, p_trainer uuid, p_session_type uuid default null
) returns int
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(g.delta - coalesce(used.amount, 0)), 0)::int
    from public.credit_ledger g
    left join lateral (
      select -sum(d.delta) as amount from public.credit_ledger d where d.grant_id = g.id
    ) used on true
   where g.client_id = p_client and g.trainer_id = p_trainer and g.delta > 0
     and (g.expires_at is null or g.expires_at > now())
     and (p_session_type is null or g.session_type_ids is null or p_session_type = any (g.session_type_ids))
$$;

-- Consume credits FIFO by expiry. Raises if insufficient.
create or replace function public.consume_credits(
  p_client uuid, p_trainer uuid, p_session_type uuid, p_amount int, p_booking uuid
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  remaining int := p_amount;
  g record;
  take int;
begin
  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_client::text, 0));
  for g in
    select l.id, l.delta - coalesce((select -sum(d.delta) from public.credit_ledger d where d.grant_id = l.id), 0) as available
      from public.credit_ledger l
     where l.client_id = p_client and l.trainer_id = p_trainer and l.delta > 0
       and (l.expires_at is null or l.expires_at > now())
       and (l.session_type_ids is null or p_session_type = any (l.session_type_ids))
     order by l.expires_at nulls last, l.created_at
  loop
    exit when remaining <= 0;
    continue when g.available <= 0;
    take := least(g.available, remaining);
    insert into public.credit_ledger (client_id, trainer_id, delta, reason, booking_id, grant_id)
    values (p_client, p_trainer, -take, 'booking', p_booking, g.id);
    remaining := remaining - take;
  end loop;
  if remaining > 0 then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;
end $$;

-- Return credits spent on a booking (cancelled outside the late window): the
-- debit rows are removed so the original grants (and expiries) are restored.
create or replace function public.refund_booking_credits(p_booking uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_total int := 0;
begin
  with debits as (
    select id, client_id, trainer_id, delta, grant_id from public.credit_ledger
     where booking_id = p_booking and reason = 'booking'
  ), del as (
    delete from public.credit_ledger where id in (select id from debits) returning delta
  )
  select coalesce(-sum(delta), 0) into v_total from del;
  return v_total;
end $$;

-- Ensure a trainer/client conversation exists.
create or replace function public.ensure_conversation(p_trainer uuid, p_client uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and auth.uid() not in (p_trainer, p_client) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.conversations (trainer_id, client_id) values (p_trainer, p_client)
  on conflict (trainer_id, client_id) do nothing;
  select id into v_id from public.conversations where trainer_id = p_trainer and client_id = p_client;
  return v_id;
end $$;

-- Copy a template program to a client.
create or replace function public.assign_program(
  p_template uuid, p_client uuid, p_start date
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.programs;
  v_new uuid;
  w record;
  v_w uuid;
begin
  select * into t from public.programs where id = p_template;
  if not found then raise exception 'program_not_found'; end if;
  if auth.uid() is not null and t.trainer_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.programs (trainer_id, client_id, template_id, name, description, goal, duration_weeks, start_date, status)
  values (t.trainer_id, p_client, t.id, t.name, t.description, t.goal, t.duration_weeks, p_start, 'active')
  returning id into v_new;

  for w in select * from public.program_workouts where program_id = t.id loop
    insert into public.program_workouts (program_id, week, day, name, notes, estimated_minutes, sort_order)
    values (v_new, w.week, w.day, w.name, w.notes, w.estimated_minutes, w.sort_order)
    returning id into v_w;
    insert into public.workout_exercises (workout_id, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes)
    select v_w, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes
      from public.workout_exercises where workout_id = w.id;
  end loop;

  return v_new;
end $$;

-- Lead upsert from public forms (merges repeat submissions, keeps first-touch attribution).
create or replace function public.capture_lead(p jsonb) returns public.leads
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.leads;
  v_is_new boolean;
begin
  insert into public.leads (
    trainer_id, email, first_name, last_name, phone, primary_goal, goal_details,
    experience_level, preferred_format, budget_range, timeline, zip_code, how_heard,
    source, lead_magnet_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer_url, landing_page, ip_address, user_agent, country,
    marketing_consent, consent_text, consented_at
  ) values (
    (p ->> 'trainer_id')::uuid, lower(p ->> 'email'), p ->> 'first_name', p ->> 'last_name',
    p ->> 'phone', p ->> 'primary_goal', p ->> 'goal_details', p ->> 'experience_level',
    p ->> 'preferred_format', p ->> 'budget_range', p ->> 'timeline', p ->> 'zip_code',
    p ->> 'how_heard', coalesce(p ->> 'source', 'contact_form'), (p ->> 'lead_magnet_id')::uuid,
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_term', p ->> 'utm_content',
    p ->> 'referrer_url', p ->> 'landing_page', (p ->> 'ip_address')::inet, p ->> 'user_agent',
    p ->> 'country', coalesce((p ->> 'marketing_consent')::boolean, false), p ->> 'consent_text',
    case when coalesce((p ->> 'marketing_consent')::boolean, false) then now() end
  )
  on conflict (trainer_id, email) do update set
    first_name = coalesce(excluded.first_name, leads.first_name),
    last_name = coalesce(excluded.last_name, leads.last_name),
    phone = coalesce(excluded.phone, leads.phone),
    primary_goal = coalesce(excluded.primary_goal, leads.primary_goal),
    goal_details = coalesce(excluded.goal_details, leads.goal_details),
    experience_level = coalesce(excluded.experience_level, leads.experience_level),
    preferred_format = coalesce(excluded.preferred_format, leads.preferred_format),
    budget_range = coalesce(excluded.budget_range, leads.budget_range),
    timeline = coalesce(excluded.timeline, leads.timeline),
    zip_code = coalesce(excluded.zip_code, leads.zip_code),
    how_heard = coalesce(excluded.how_heard, leads.how_heard),
    marketing_consent = leads.marketing_consent or excluded.marketing_consent,
    consent_text = coalesce(excluded.consent_text, leads.consent_text),
    consented_at = coalesce(leads.consented_at, excluded.consented_at),
    unsubscribed_at = case when excluded.marketing_consent then null else leads.unsubscribed_at end,
    status = case when leads.status in ('lost', 'unsubscribed') then 'new'::public.lead_status else leads.status end,
    score = leads.score + 5
  returning * into l;
  v_is_new := l.created_at = now();

  insert into public.lead_events (lead_id, type, detail)
  values (l.id, 'captured', jsonb_build_object(
    'source', p ->> 'source', 'lead_magnet_id', p ->> 'lead_magnet_id',
    'utm_campaign', p ->> 'utm_campaign', 'landing_page', p ->> 'landing_page', 'repeat', not v_is_new));

  return l;
end $$;

-- Expire unpaid booking holds (called by cron).
create or replace function public.expire_booking_holds() returns int
language sql security definer set search_path = public, extensions as $$
  with x as (
    update public.bookings set status = 'cancelled', cancel_reason = 'payment_not_completed', cancelled_at = now()
     where status = 'pending_payment' and hold_expires_at < now()
    returning 1
  ) select count(*)::int from x
$$;

revoke execute on function public.reserve_booking from public, anon, authenticated;
revoke execute on function public.consume_credits from public, anon, authenticated;
revoke execute on function public.refund_booking_credits from public, anon, authenticated;
revoke execute on function public.capture_lead from public, anon, authenticated;
revoke execute on function public.expire_booking_holds from public, anon, authenticated;
