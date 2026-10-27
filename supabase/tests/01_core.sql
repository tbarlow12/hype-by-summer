-- Behavioural tests for booking, credits, leads and RLS. Each assertion raises
-- on failure; everything runs in a transaction that is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'coach@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-00000000000b', 'client@example.com', '{"full_name":"Client B"}'),
  ('00000000-0000-0000-0000-00000000000c', 'other@example.com', '{"full_name":"Client C"}');

do $$
declare
  t uuid := '00000000-0000-0000-0000-00000000000a';
  cb uuid := '00000000-0000-0000-0000-00000000000b';
  cc uuid := '00000000-0000-0000-0000-00000000000c';
  pt uuid; grp uuid; b public.bookings; l public.leads; n int; ok boolean;
  g uuid;
begin
  -- Every signup is a client (the app promotes OWNER_EMAIL to trainer).
  assert (select role from public.profiles where id = t) = 'client', 'signups start as clients';
  assert (select role from public.profiles where id = cb) = 'client', 'second user should be client';
  update public.profiles set role = 'trainer' where id = t;

  insert into public.trainer_profiles (trainer_id, slug, business_name) values (t, 'coach', 'Coach Co');
  insert into public.trainer_clients (trainer_id, client_id) values (t, cb);

  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents, buffer_after_minutes)
  values (t, 'pt-60', '1:1 Training', 60, 9000, 15) returning id into pt;
  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents, capacity)
  values (t, 'bootcamp', 'Bootcamp', 45, 2500, 2) returning id into grp;

  -- Reserve a 1:1 slot.
  b := public.reserve_booking(pt, '2030-01-07 15:00Z', cb, null, null, null, 'confirmed', 'stripe', 15, null);
  assert b.ends_at = '2030-01-07 16:00Z', 'end computed from duration';
  assert upper(b.blocked_range) = '2030-01-07 16:15Z', 'buffer applied';

  -- Overlap (including the buffer) is rejected.
  begin
    perform public.reserve_booking(pt, '2030-01-07 16:00Z', cc, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected conflict';
  exception when others then
    assert sqlerrm = 'slot_conflict', 'buffer overlap should conflict, got ' || sqlerrm;
  end;
  -- Right after the buffer is fine.
  perform public.reserve_booking(pt, '2030-01-07 16:15Z', cc, null, null, null, 'confirmed', 'stripe', 15, null);

  -- Group class: capacity 2, third is full, same client twice rejected.
  perform public.reserve_booking(grp, '2030-01-08 15:00Z', cb, null, null, null, 'confirmed', 'stripe', 15, null);
  begin
    perform public.reserve_booking(grp, '2030-01-08 15:00Z', cb, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected already_booked';
  exception when others then assert sqlerrm = 'already_booked', sqlerrm; end;
  perform public.reserve_booking(grp, '2030-01-08 15:00Z', null, 'Guest', 'guest@example.com', null, 'confirmed', 'stripe', 15, null);
  begin
    perform public.reserve_booking(grp, '2030-01-08 15:00Z', cc, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;

  -- Expired pending holds no longer block.
  b := public.reserve_booking(pt, '2030-01-09 15:00Z', cb, null, null, null, 'pending_payment', 'stripe', 15, null);
  update public.bookings set hold_expires_at = now() - interval '1 minute' where id = b.id;
  perform public.reserve_booking(pt, '2030-01-09 15:00Z', cc, null, null, null, 'confirmed', 'stripe', 15, null);
  assert public.expire_booking_holds() = 1, 'one hold expired';

  -- Time off blocks booking.
  insert into public.availability_overrides (trainer_id, starts_at, ends_at, is_available)
  values (t, '2030-01-10 00:00Z', '2030-01-11 00:00Z', false);
  begin
    perform public.reserve_booking(pt, '2030-01-10 15:00Z', cb, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_unavailable';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;

  -- Credits: two grants, earliest-expiring consumed first; refund restores.
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, expires_at)
  values (cb, t, 2, 'purchase', now() + interval '10 days') returning id into g;
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, expires_at)
  values (cb, t, 5, 'purchase', now() + interval '90 days');
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, expires_at)
  values (cb, t, 9, 'purchase', now() - interval '1 day');            -- expired
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, session_type_ids)
  values (cb, t, 4, 'purchase', array[grp]);                            -- bootcamp only
  assert public.credit_balance(cb, t, pt) = 7, 'balance for 1:1 = 7, got ' || public.credit_balance(cb, t, pt);
  assert public.credit_balance(cb, t, grp) = 11, 'balance for bootcamp = 11';

  b := public.reserve_booking(pt, '2030-02-01 15:00Z', cb, null, null, null, 'confirmed', 'credits', 15, null);
  perform public.consume_credits(cb, t, pt, 3, b.id);
  assert public.credit_balance(cb, t, pt) = 4, 'after consuming 3';
  assert (select -sum(delta) from public.credit_ledger where grant_id = g) = 2, 'earliest grant drained first';
  begin
    perform public.consume_credits(cb, t, pt, 5, b.id);
    raise exception 'expected insufficient';
  exception when others then assert sqlerrm = 'insufficient_credits', sqlerrm; end;
  assert public.refund_booking_credits(b.id) = 3, 'refund returns 3';
  assert public.credit_balance(cb, t, pt) = 7, 'balance restored';

  -- Leads: upsert keeps first-touch attribution, merges new info, logs events.
  l := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'Lead@Example.com',
        'first_name', 'Lee', 'source', 'lead_magnet', 'utm_campaign', 'summer', 'marketing_consent', true));
  assert l.email = 'lead@example.com' and l.utm_campaign = 'summer' and l.marketing_consent, 'lead created';
  l := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'lead@example.com',
        'phone', '555-0100', 'utm_campaign', 'fall', 'primary_goal', 'build_muscle'));
  assert l.first_name = 'Lee' and l.phone = '555-0100' and l.utm_campaign = 'summer'
     and l.primary_goal = 'build_muscle' and l.marketing_consent, 'lead merged';
  assert (select count(*) from public.lead_events where lead_id = l.id) = 2, 'two capture events';
  assert (select count(*) from public.leads) = 1, 'single lead row';

  -- Guest booking is linked when that email signs up.
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'guest@example.com');
  assert (select count(*) from public.bookings where client_id = '00000000-0000-0000-0000-00000000000d') = 1,
    'guest booking linked on signup';

  -- Program assignment clones workouts and exercises.
  declare prog uuid; w uuid; assigned uuid;
  begin
    insert into public.programs (trainer_id, name) values (t, 'Strength 101') returning id into prog;
    insert into public.program_workouts (program_id, week, day, name) values (prog, 1, 1, 'Lower') returning id into w;
    insert into public.workout_exercises (workout_id, exercise_id, sets, reps)
      select w, id, 3, '8' from public.exercises where name = 'Back Squat';
    assigned := public.assign_program(prog, cb, '2030-01-01');
    assert (select count(*) from public.workout_exercises we join public.program_workouts pw on pw.id = we.workout_id
             where pw.program_id = assigned) = 1, 'program cloned';
  end;
end $$;

-- RLS: act as client C (not this trainer's client) and client B.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'C sees only own profile';
  assert (select count(*) from public.leads) = 0, 'clients cannot see leads';
  assert (select count(*) from public.programs) = 0, 'C sees no programs';
  assert (select count(*) from public.bookings) = 2, 'C sees own bookings only';
  assert (select count(*) from public.session_types) = 2, 'public session types visible';
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.profiles) = 2, 'B sees self + trainer';
  assert (select count(*) from public.programs) = 1, 'B sees assigned program';
  assert (select count(*) from public.credit_ledger) = 4, 'B sees own credits';
  assert (select count(*) from public.client_notes) = 0, 'client never sees trainer notes';
  begin
    update public.profiles set role = 'trainer' where id = auth.uid();
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;
  begin
    perform calendar_feed_token from public.trainer_profiles;
    raise exception 'expected privilege error on feed token';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.leads) = 1, 'trainer sees leads';
  assert (select count(*) from public.profiles) = 2, 'trainer sees self + linked client';
end $$;

rollback;
