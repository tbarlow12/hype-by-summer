-- Scheduling: multi-coach reservations, closures, reassignment and
-- per-coach availability permissions.
begin;

insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'owner10@example.com'),
  ('a2000000-0000-0000-0000-000000000002', 'coach10a@example.com'),
  ('a2000000-0000-0000-0000-000000000003', 'coach10b@example.com'),
  ('a2000000-0000-0000-0000-000000000009', 'other10@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'client10@example.com');
insert into public.businesses (id, slug, name) values
  ('b2000000-0000-0000-0000-000000000001', 'sched-one', 'Sched One'),
  ('b2000000-0000-0000-0000-000000000002', 'sched-two', 'Sched Two');
insert into public.business_members (business_id, user_id, role) values
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'owner'),
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'coach'),
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000003', 'coach'),
  ('b2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000009', 'owner');
insert into public.business_clients (business_id, client_id, primary_coach_id) values
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000003');

do $$
declare
  biz uuid := 'b2000000-0000-0000-0000-000000000001';
  ca uuid := 'a2000000-0000-0000-0000-000000000002';
  cb uuid := 'a2000000-0000-0000-0000-000000000003';
  other uuid := 'a2000000-0000-0000-0000-000000000009';
  cl uuid := 'c2000000-0000-0000-0000-000000000001';
  pt uuid; solo uuid; grp uuid; b1 public.bookings; b2 public.bookings; moved public.bookings;
begin
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes, buffer_after_minutes)
    values (biz, array[ca, cb], 'pt10', 'PT', 60, 15) returning id into pt;
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes)
    values (biz, array[ca], 'solo10', 'Solo', 30) returning id into solo;
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes, capacity)
    values (biz, array[ca, cb], 'grp10', 'Group', 45, 2) returning id into grp;

  -- Two coaches can take the same 1:1 start; each coach can't be double-booked.
  b1 := public.reserve_booking(pt, ca, '2030-03-04 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
  b2 := public.reserve_booking(pt, cb, '2030-03-04 15:00Z', null, 'G', 'g10@example.com', null, 'confirmed', 'pay_later', 15, null);
  assert b1.coach_id = ca and b2.coach_id = cb and b1.business_id = biz, 'per-coach bookings';
  begin
    perform public.reserve_booking(pt, ca, '2030-03-04 16:00Z', null, 'H', 'h10@example.com', null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected slot_conflict (buffer after)';
  exception when others then assert sqlerrm = 'slot_conflict', sqlerrm; end;

  -- A coach who doesn't run the type, or isn't on the team, can't be booked.
  begin
    perform public.reserve_booking(solo, cb, '2030-03-05 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected coach_not_available';
  exception when others then assert sqlerrm = 'coach_not_available', sqlerrm; end;
  begin
    perform public.reserve_booking(pt, other, '2030-03-05 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected coach_not_available (other business)';
  exception when others then assert sqlerrm = 'coach_not_available', sqlerrm; end;

  -- Group capacity is per coach.
  perform public.reserve_booking(grp, ca, '2030-03-06 15:00Z', null, 'X', 'x10@example.com', null, 'confirmed', 'pay_later', 15, null);
  perform public.reserve_booking(grp, ca, '2030-03-06 15:00Z', null, 'Y', 'y10@example.com', null, 'confirmed', 'pay_later', 15, null);
  begin
    perform public.reserve_booking(grp, ca, '2030-03-06 15:00Z', null, 'Z', 'z10@example.com', null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
  perform public.reserve_booking(grp, cb, '2030-03-06 15:00Z', null, 'Z', 'z10@example.com', null, 'confirmed', 'pay_later', 15, null);

  -- Coach time off blocks that coach only; a business closure (coach_id null) blocks everyone.
  insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at)
    values (biz, ca, '2030-03-07 00:00Z', '2030-03-08 00:00Z');
  begin
    perform public.reserve_booking(pt, ca, '2030-03-07 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected slot_unavailable';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;
  perform public.reserve_booking(pt, cb, '2030-03-07 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
  insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at, reason)
    values (biz, null, '2030-03-08 00:00Z', '2030-03-09 00:00Z', 'Holiday');
  begin
    perform public.reserve_booking(pt, cb, '2030-03-08 15:00Z', cl, null, null, null, 'confirmed', 'pay_later', 15, null);
    raise exception 'expected slot_unavailable (closure)';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;
  begin
    insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at, is_available)
      values (biz, null, '2030-03-10 00:00Z', '2030-03-11 00:00Z', true);
    raise exception 'expected check violation (closure must block)';
  exception when check_violation then null; end;

  -- Reassign: reschedule to another coach at the same time; the old row is cancelled.
  moved := public.reschedule_booking(b1.id, '2030-03-04 17:00Z', ca, cb);
  assert moved.coach_id = cb and moved.rescheduled_from = b1.id and moved.client_id = cl, 'reassigned';
  assert (select status from public.bookings where id = b1.id) = 'cancelled', 'old booking cancelled';
  begin
    perform public.reschedule_booking(moved.id, '2030-03-04 17:00Z', ca, cb);
    raise exception 'expected same_time';
  exception when others then assert sqlerrm = 'same_time', sqlerrm; end;
  moved := public.reschedule_booking(moved.id, '2030-03-04 17:00Z', ca, ca);
  assert moved.coach_id = ca, 'same time, other coach is allowed';

  -- Waitlist rows are per coach.
  insert into public.waitlist_entries (business_id, session_type_id, coach_id, starts_at, email)
    values (biz, grp, ca, '2030-03-06 15:00Z', 'w10@example.com'), (biz, grp, cb, '2030-03-06 15:00Z', 'w10@example.com');
  assert (select count(*) from public.waitlist_entries where email = 'w10@example.com') = 2, 'waitlist per coach';

  insert into public.availability_rules (business_id, coach_id, weekday, start_time, end_time)
    values (biz, ca, 1, '09:00', '12:00'), (biz, cb, 1, '09:00', '12:00');
end $$;

-- Coach A edits only their own hours / time off; closures are managers' only.
set local role authenticated;
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000002';
do $$
declare
  biz uuid := 'b2000000-0000-0000-0000-000000000001';
  ca uuid := 'a2000000-0000-0000-0000-000000000002';
  cb uuid := 'a2000000-0000-0000-0000-000000000003';
  n int;
begin
  insert into public.availability_rules (business_id, coach_id, weekday, start_time, end_time) values (biz, ca, 2, '09:00', '10:00');
  begin
    insert into public.availability_rules (business_id, coach_id, weekday, start_time, end_time) values (biz, cb, 2, '09:00', '10:00');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
  delete from public.availability_rules where coach_id = cb;
  get diagnostics n = row_count;
  assert n = 0, 'cannot delete another coach''s hours';
  assert (select count(*) from public.availability_rules where coach_id = cb) = 1, 'but can read them';
  begin
    insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at) values (biz, null, '2030-04-01 00:00Z', '2030-04-02 00:00Z');
    raise exception 'expected rls violation (closure)';
  exception when insufficient_privilege then null; end;
  -- The whole team's bookings are visible (team calendar).
  assert (select count(distinct coach_id) from public.bookings where business_id = biz) = 2, 'team calendar';
end $$;

-- The owner edits anyone's hours and closures.
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000001';
do $$
declare biz uuid := 'b2000000-0000-0000-0000-000000000001'; cb uuid := 'a2000000-0000-0000-0000-000000000003';
begin
  insert into public.availability_rules (business_id, coach_id, weekday, start_time, end_time) values (biz, cb, 3, '09:00', '10:00');
  insert into public.availability_overrides (business_id, coach_id, starts_at, ends_at) values (biz, null, '2030-04-01 00:00Z', '2030-04-02 00:00Z');
  assert (select count(*) from public.availability_overrides where coach_id is null) = 2, 'manager adds closures';
end $$;

-- Another business's owner sees none of it; the client sees hours but no time off.
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000009';
do $$ begin
  assert (select count(*) from public.availability_rules) = 0, 'rules isolated';
  assert (select count(*) from public.availability_overrides) = 0, 'overrides isolated';
  assert (select count(*) from public.waitlist_entries) = 0, 'waitlist isolated';
end $$;
set local request.jwt.claim.sub = 'c2000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.availability_rules) > 0, 'client reads hours';
  assert (select count(*) from public.availability_overrides) = 0, 'client never sees time off reasons';
  assert (select count(*) from public.bookings where client_id <> auth.uid()) = 0, 'own bookings only';
end $$;

rollback;
