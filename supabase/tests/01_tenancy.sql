-- Tenancy: businesses are isolated, roles hold, clients see only their own data.
begin;

-- People: A has an owner + a coach; B has an owner. c1 trains at A; c2 at A and B.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner.a@example.com', '{"full_name":"Owner A"}'),
  ('a0000000-0000-0000-0000-000000000002', 'coach.a@example.com', '{"full_name":"Coach A"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner.b@example.com', '{"full_name":"Owner B"}'),
  ('c0000000-0000-0000-0000-000000000001', 'c1@example.com', '{"full_name":"Client One"}'),
  ('c0000000-0000-0000-0000-000000000002', 'c2@example.com', '{"full_name":"Client Two"}');

-- Businesses are created by their owners through the RPC.
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select set_config('test.biz_a', (public.create_business('studio-a', 'Studio A', 'America/Denver')).id::text, true) is not null as _a \gset
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select set_config('test.biz_b', (public.create_business('studio-b', 'Studio B', 'America/New_York')).id::text, true) is not null as _b \gset
do $$ begin
  perform public.create_business('admin', 'Nope', 'UTC');
  raise exception 'expected reserved slug rejection';
exception when check_violation then null;
end $$;
reset role;
set local request.jwt.claim.sub = '';

-- Setup as superuser: team, clients, sessions, data in both businesses.
do $$
declare
  a uuid := current_setting('test.biz_a')::uuid;
  b uuid := current_setting('test.biz_b')::uuid;
  oa uuid := 'a0000000-0000-0000-0000-000000000001';
  ca uuid := 'a0000000-0000-0000-0000-000000000002';
  ob uuid := 'b0000000-0000-0000-0000-000000000001';
  c1 uuid := 'c0000000-0000-0000-0000-000000000001';
  c2 uuid := 'c0000000-0000-0000-0000-000000000002';
  pt uuid; grp uuid; ptb uuid; bk public.bookings;
begin
  assert (select role from public.business_members where business_id = a and user_id = oa) = 'owner', 'creator is owner';
  insert into public.business_members (business_id, user_id, role, slug) values (a, ca, 'coach', 'coach-a');
  insert into public.business_clients (business_id, client_id, primary_coach_id) values (a, c1, ca), (a, c2, oa), (b, c2, ob);

  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes, price_cents, buffer_after_minutes)
  values (a, array[oa, ca], 'pt', '1:1', 60, 9000, 15) returning id into pt;
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes, capacity)
  values (a, array[ca], 'bootcamp', 'Bootcamp', 45, 2) returning id into grp;
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes)
  values (b, array[ob], 'pt', '1:1 B', 60) returning id into ptb;

  -- Booking rules are per coach.
  begin
    perform public.reserve_booking(ptb, oa, '2030-01-07 15:00Z', c2, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected coach_not_available';
  exception when others then assert sqlerrm = 'coach_not_available', sqlerrm; end;
  bk := public.reserve_booking(pt, ca, '2030-01-07 15:00Z', c1, null, null, null, 'confirmed', 'stripe', 15, null);
  assert bk.business_id = a and bk.coach_id = ca, 'booking carries business + coach';
  -- Same coach, overlapping another session type: conflict.
  begin
    perform public.reserve_booking(grp, ca, '2030-01-07 15:30Z', c2, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_conflict';
  exception when others then assert sqlerrm = 'slot_conflict', sqlerrm; end;
  -- A different coach at the same time is fine.
  perform public.reserve_booking(pt, oa, '2030-01-07 15:00Z', c2, null, null, null, 'confirmed', 'stripe', 15, null);
  -- Buffer respected: coach A free again at 16:15.
  perform public.reserve_booking(pt, ca, '2030-01-07 16:15Z', c2, null, null, null, 'confirmed', 'stripe', 15, null);
  -- Group capacity per coach + start.
  perform public.reserve_booking(grp, ca, '2030-01-08 15:00Z', c1, null, null, null, 'confirmed', 'stripe', 15, null);
  perform public.reserve_booking(grp, ca, '2030-01-08 15:00Z', null, 'Guest', 'guest@example.com', null, 'confirmed', 'stripe', 15, null);
  begin
    perform public.reserve_booking(grp, ca, '2030-01-08 15:00Z', c2, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
  -- Coach time off blocks only that coach; business closure blocks everyone.
  insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at) values (a, ca, '2030-01-09', '2030-01-10');
  begin
    perform public.reserve_booking(pt, ca, '2030-01-09 15:00Z', c1, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_unavailable';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;
  perform public.reserve_booking(pt, oa, '2030-01-09 15:00Z', c1, null, null, null, 'confirmed', 'stripe', 15, null);
  insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at) values (a, null, '2030-01-11', '2030-01-12');
  begin
    perform public.reserve_booking(pt, oa, '2030-01-11 15:00Z', c1, null, null, null, 'confirmed', 'stripe', 15, null);
    raise exception 'expected slot_unavailable (closure)';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;

  -- Reschedule to another coach keeps the payment + credits link.
  bk := public.reschedule_booking(bk.id, '2030-01-14 15:00Z', c1, oa);
  assert bk.coach_id = oa and bk.status = 'confirmed', 'rescheduled to new coach';

  -- Credits are per business.
  insert into public.credit_ledger (business_id, client_id, delta, reason) values (a, c2, 3, 'purchase');
  assert public.credit_balance(c2, a) = 3 and public.credit_balance(c2, b) = 0, 'credits stay in their business';
  begin
    perform public.consume_credits(c2, b, ptb, 1, null);
    raise exception 'expected insufficient_credits';
  exception when others then assert sqlerrm = 'insufficient_credits', sqlerrm; end;

  -- Same email is a separate lead per business.
  perform public.capture_lead(jsonb_build_object('business_id', a, 'email', 'lead@example.com', 'first_name', 'Lee'));
  perform public.capture_lead(jsonb_build_object('business_id', b, 'email', 'LEAD@example.com'));
  assert (select count(*) from public.leads where email = 'lead@example.com') = 2, 'lead per business';

  -- Client health data per business.
  insert into public.body_metrics (business_id, client_id, weight) values (a, c2, 150), (b, c2, 151);
  perform public.ensure_conversation(a, c2);
  perform public.ensure_conversation(b, c2);
  insert into public.lead_magnets (business_id, slug, title) values (a, 'guide', 'A guide'), (b, 'guide', 'B guide');
end $$;

-- ---------------------------------------------------------------------------
-- Coach A: sees Studio A only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
do $$
declare a uuid := current_setting('test.biz_a')::uuid; b uuid := current_setting('test.biz_b')::uuid;
begin
  assert (select count(*) from public.bookings where business_id = b) = 0, 'no cross-business bookings';
  assert (select count(*) from public.bookings) > 0, 'sees own business bookings';
  assert (select count(*) from public.leads) = 1, 'leads isolated';
  assert (select count(*) from public.business_clients) = 2, 'roster isolated';
  assert (select count(*) from public.body_metrics) = 1, 'metrics isolated';
  assert (select count(*) from public.conversations) = 1, 'threads isolated';
  assert (select count(*) from public.conversation_inbox(a)) = 1, 'inbox works';
  assert (select count(*) from public.conversation_inbox(b)) = 0, 'inbox of other business empty';
  assert public.credit_balance('c0000000-0000-0000-0000-000000000002', a) = 3, 'staff read client credits';
  begin
    perform public.credit_balance('c0000000-0000-0000-0000-000000000002', b);
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null; end;
  -- A coach cannot change business settings or promote themself.
  update public.businesses set name = 'Hacked' where id = a;
  assert (select name from public.businesses where id = a) = 'Studio A', 'coach cannot edit business';
  begin
    update public.business_members set role = 'owner' where user_id = auth.uid();
    raise exception 'expected role guard';
  exception when insufficient_privilege then null; end;
  update public.business_members set bio = 'Strength coach' where user_id = auth.uid();
  assert (select bio from public.business_members where user_id = auth.uid()) = 'Strength coach', 'coach edits own profile';
  -- Coaches can't see business payments that aren't theirs or the plan/billing columns.
  begin
    perform plan from public.businesses;
    raise exception 'expected privilege error on plan';
  exception when insufficient_privilege then null; end;
  begin
    perform calendar_feed_token from public.business_members;
    raise exception 'expected privilege error on feed token';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Owner A: manages settings; cannot leave the business without an owner.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
do $$
declare a uuid := current_setting('test.biz_a')::uuid;
begin
  update public.businesses set name = 'Studio A+' where id = a;
  assert (select name from public.businesses where id = a) = 'Studio A+', 'owner edits business';
  begin
    update public.business_members set role = 'coach' where user_id = auth.uid() and business_id = a;
    raise exception 'expected last-owner guard';
  exception when check_violation then null; end;
  begin
    update public.businesses set plan = 'pro' where id = a;
    raise exception 'expected privilege error on plan';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Owner B: sees nothing of Studio A.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.bookings) = 0, 'B sees no A bookings';
  assert (select count(*) from public.business_clients) = 1, 'B roster only';
  assert (select count(*) from public.body_metrics) = 1 and (select weight from public.body_metrics) = 151, 'B sees only its metrics';
  assert (select count(*) from public.credit_ledger) = 0, 'B sees no A credits';
end $$;

-- ---------------------------------------------------------------------------
-- Client c2 (at A and B): sees own rows in both, nothing of other clients.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000002';
do $$
declare a uuid := current_setting('test.biz_a')::uuid; b uuid := current_setting('test.biz_b')::uuid;
begin
  assert (select count(*) from public.bookings where client_id <> auth.uid()) = 0, 'only own bookings';
  assert (select count(*) from public.body_metrics) = 2, 'own metrics in both businesses';
  assert (select count(*) from public.leads) = 0, 'clients never see leads';
  assert (select count(*) from public.business_clients) = 2, 'own memberships';
  assert (select count(*) from public.client_notes) = 0, 'no staff notes';
  -- Can write own data only into businesses they belong to.
  insert into public.body_metrics (business_id, client_id, weight) values (a, auth.uid(), 149);
  begin
    insert into public.check_ins (business_id, client_id, week_of)
    values ('00000000-0000-0000-0000-000000000000', auth.uid(), '2030-01-06');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
  -- Client cannot write a coach reply.
  insert into public.check_ins (business_id, client_id, week_of, wins, coach_response)
  values (a, auth.uid(), '2030-01-06', 'PR!', 'self-praise');
  assert (select coach_response from public.check_ins where business_id = a) is null, 'reply stripped';
end $$;

-- Staff reply: only the reply columns change.
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
do $$ begin
  update public.check_ins set coach_response = 'Great work', wins = 'tampered';
  assert (select wins from public.check_ins) = 'PR!', 'content untouched';
  assert (select coach_response from public.check_ins) = 'Great work', 'reply saved';
  assert (select responded_by from public.check_ins) = auth.uid(), 'responder recorded';
end $$;

-- Client c1 (A only) can't see B's members-only session types or log into B.
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000001';
do $$
declare b uuid := current_setting('test.biz_b')::uuid;
begin
  assert (select count(*) from public.conversations) = 0, 'c1 has no threads yet';
  begin
    perform public.log_workout(jsonb_build_object('business_id', b), '[]'::jsonb);
    raise exception 'expected not_a_client';
  exception when insufficient_privilege then null; end;
end $$;

-- Anonymous API callers see no business at all (no hidden directory).
set local role anon;
set local request.jwt.claim.sub = '';
do $$ begin
  begin
    perform 1 from public.businesses;
    raise exception 'expected anon to be denied';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.session_types;
    raise exception 'expected anon to be denied';
  exception when insufficient_privilege then null; end;
end $$;

-- A client of A can't see Studio B's existence.
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.businesses) = 1, 'client sees only their business';
  assert (select count(*) from public.lead_magnets) = 0, 'clients do not list giveaways via the API';
end $$;

rollback;
