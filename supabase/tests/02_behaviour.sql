-- Credits, holds, leads, program assignment and storage access.
begin;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('c1000000-0000-0000-0000-000000000001', 'client@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'stranger@example.com');
insert into public.businesses (id, slug, name) values
  ('b1000000-0000-0000-0000-000000000001', 'gym-one', 'Gym One'),
  ('b1000000-0000-0000-0000-000000000002', 'gym-two', 'Gym Two');
insert into public.business_members (business_id, user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'owner');
insert into public.business_clients (business_id, client_id) values
  ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');

do $$
declare
  biz uuid := 'b1000000-0000-0000-0000-000000000001';
  biz2 uuid := 'b1000000-0000-0000-0000-000000000002';
  coach uuid := 'a1000000-0000-0000-0000-000000000001';
  cl uuid := 'c1000000-0000-0000-0000-000000000001';
  pt uuid; grp uuid; g uuid; b public.bookings; l public.leads; prog uuid; w uuid; assigned uuid;
begin
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes) values (biz, array[coach], 'pt', 'PT', 60) returning id into pt;
  insert into public.session_types (business_id, coach_ids, slug, name, duration_minutes) values (biz, array[coach], 'grp', 'Group', 45) returning id into grp;

  -- Credits: earliest-expiring grant first, expired ignored, type-restricted grants respected.
  insert into public.credit_ledger (business_id, client_id, delta, reason, expires_at) values (biz, cl, 2, 'purchase', now() + interval '10 days') returning id into g;
  insert into public.credit_ledger (business_id, client_id, delta, reason, expires_at) values (biz, cl, 5, 'purchase', now() + interval '90 days');
  insert into public.credit_ledger (business_id, client_id, delta, reason, expires_at) values (biz, cl, 9, 'purchase', now() - interval '1 day');
  insert into public.credit_ledger (business_id, client_id, delta, reason, session_type_ids) values (biz, cl, 4, 'purchase', array[grp]);
  assert public.credit_balance(cl, biz, pt) = 7, 'pt balance 7';
  assert public.credit_balance(cl, biz, grp) = 11, 'group balance 11';
  b := public.reserve_booking(pt, coach, '2030-02-01 15:00Z', cl, null, null, null, 'confirmed', 'credits', 15, null);
  perform public.consume_credits(cl, biz, pt, 3, b.id);
  assert public.credit_balance(cl, biz, pt) = 4, 'after consuming 3';
  assert (select -sum(delta) from public.credit_ledger where grant_id = g) = 2, 'earliest grant drained first';
  assert public.refund_booking_credits(b.id) = 3, 'refund 3';
  assert public.credit_balance(cl, biz, pt) = 7, 'restored';
  assert public.debit_credits(cl, biz, 100, 'adjustment') = 11, 'debit never exceeds available';
  assert public.outstanding_credits(biz) = 0, 'nothing outstanding';

  -- Expired holds stop blocking and get swept.
  b := public.reserve_booking(pt, coach, '2030-02-02 15:00Z', cl, null, null, null, 'pending_payment', 'stripe', 15, null);
  update public.bookings set hold_expires_at = now() - interval '1 minute' where id = b.id;
  perform public.reserve_booking(pt, coach, '2030-02-02 15:00Z', null, 'G', 'g@example.com', null, 'confirmed', 'stripe', 15, null);
  assert public.expire_booking_holds() = 1, 'one hold expired';

  -- Leads: first touch kept, details merged, consent never silently restored.
  l := public.capture_lead(jsonb_build_object('business_id', biz, 'email', 'Lee@Example.com', 'first_name', 'Lee',
         'source', 'lead_magnet', 'utm_campaign', 'summer', 'marketing_consent', true));
  perform public.unsubscribe_lead(l.unsubscribe_token);
  l := public.capture_lead(jsonb_build_object('business_id', biz, 'email', 'lee@example.com', 'phone', '555-0100',
         'utm_campaign', 'fall', 'primary_goal', 'build_muscle'));
  assert l.first_name = 'Lee' and l.phone = '555-0100' and l.utm_campaign = 'summer', 'merged, first touch kept';
  assert not l.marketing_consent and l.status = 'new', 'unsubscribed stays unsubscribed (status reopened)';
  assert (select count(*) from public.lead_events where lead_id = l.id) = 3, 'captured, unsubscribed, captured';

  -- Program assignment clones the template, only to clients of the same business.
  insert into public.programs (business_id, coach_id, name) values (biz, coach, 'Strength 101') returning id into prog;
  insert into public.program_workouts (program_id, week, day, name) values (prog, 1, 1, 'Lower') returning id into w;
  insert into public.workout_exercises (workout_id, exercise_id, sets, reps)
    select w, id, 3, '8' from public.exercises where name = 'Back Squat';
  assigned := public.assign_program(prog, cl, '2030-01-01');
  assert (select count(*) from public.workout_exercises we join public.program_workouts pw on pw.id = we.workout_id
           where pw.program_id = assigned) = 1, 'program cloned';
  begin
    perform public.assign_program(prog, 'c1000000-0000-0000-0000-000000000002', '2030-01-01');
    raise exception 'expected not_a_client';
  exception when insufficient_privilege then null; end;
end $$;

-- Storage: own folder, staff of the client's business, nobody else.
insert into storage.objects (bucket_id, name) values
  ('form-videos', 'c1000000-0000-0000-0000-000000000001/squat.mp4'),
  ('lead-magnets', 'b1000000-0000-0000-0000-000000000001/guide.pdf');

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'form-videos') = 1, 'client reads own video';
  assert (select count(*) from storage.objects where bucket_id = 'lead-magnets') = 0, 'client cannot list business files';
  insert into storage.objects (bucket_id, name) values ('progress-photos', 'c1000000-0000-0000-0000-000000000001/front.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('progress-photos', 'c1000000-0000-0000-0000-000000000002/x.jpg');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = 'a1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'form-videos') = 1, 'staff read client video';
  assert (select count(*) from storage.objects where bucket_id = 'lead-magnets') = 1, 'staff read business files';
  insert into storage.objects (bucket_id, name) values ('lead-magnets', 'b1000000-0000-0000-0000-000000000002/other.pdf');
end $$;

set local request.jwt.claim.sub = 'c1000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from storage.objects where bucket_id in ('form-videos', 'progress-photos', 'lead-magnets')) = 0,
    'strangers see nothing';
  begin
    insert into storage.objects (bucket_id, name) values ('lead-magnets', 'b1000000-0000-0000-0000-000000000001/evil.pdf');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
