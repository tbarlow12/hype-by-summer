-- Training under the multi-business model: coach-reply guard with several
-- staff, log_workout and program feedback pinned to the client's business,
-- assign_program never crossing businesses, shared program editing and
-- per-business exercise libraries.
begin;

-- People ---------------------------------------------------------------------
--   owner1   owner of Gym One           coachA, coachB   coaches at Gym One
--   owner2   owner of Gym Two           dual             coach at both gyms
--   client1  client of Gym One          client2          client of Gym Two only
--   client3  client of both gyms
insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-000000000001', 'owner1@example.com'),
  ('a3000000-0000-0000-0000-000000000002', 'coach-a@example.com'),
  ('a3000000-0000-0000-0000-000000000003', 'coach-b@example.com'),
  ('a3000000-0000-0000-0000-000000000004', 'owner2@example.com'),
  ('a3000000-0000-0000-0000-000000000005', 'dual@example.com'),
  ('c3000000-0000-0000-0000-000000000001', 'client1@example.com'),
  ('c3000000-0000-0000-0000-000000000002', 'client2@example.com'),
  ('c3000000-0000-0000-0000-000000000003', 'client3@example.com');
insert into public.businesses (id, slug, name) values
  ('b3000000-0000-0000-0000-000000000001', 'train-one', 'Train One'),
  ('b3000000-0000-0000-0000-000000000002', 'train-two', 'Train Two');
insert into public.business_members (business_id, user_id, role) values
  ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'owner'),
  ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'coach'),
  ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003', 'coach'),
  ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'coach'),
  ('b3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000004', 'owner'),
  ('b3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000005', 'coach');
insert into public.business_clients (business_id, client_id, primary_coach_id) values
  ('b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002'),
  ('b3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', null),
  ('b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000003'),
  ('b3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000003', null);

-- Gym One: a custom exercise, a template and client1's program (coach A).
insert into public.exercises (id, business_id, name) values
  ('e3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'Gym One Sled Push');
insert into public.programs (id, business_id, coach_id, client_id, name, start_date, status) values
  ('f3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', null, 'Template', null, 'active'),
  ('f3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 'Client1 block', '2030-01-01', 'active'),
  ('f3000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', 'Client3 at One', '2030-01-01', 'active');
insert into public.program_workouts (id, program_id, week, day, name) values
  ('d3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 1, 1, 'Template day'),
  ('d3000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000002', 1, 1, 'Client1 day'),
  ('d3000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000003', 1, 1, 'Client3 day');
insert into public.workout_exercises (id, workout_id, exercise_id, sets, reps) values
  ('ee300000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 3, '8'),
  ('ee300000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 3, '8');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- log_workout: the client logs at a business they belong to, for a workout of
-- their own program there; the reply columns are never theirs to set.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'c3000000-0000-0000-0000-000000000001';
do $$
declare v uuid;
begin
  v := public.log_workout(
    jsonb_build_object('business_id', 'b3000000-0000-0000-0000-000000000001', 'workout_id', 'd3000000-0000-0000-0000-000000000002',
                       'performed_on', '2030-01-01', 'feedback', 'Felt good'),
    jsonb_build_array(jsonb_build_object('exercise_id', 'e3000000-0000-0000-0000-000000000001',
                      'workout_exercise_id', 'ee300000-0000-0000-0000-000000000002', 'set_number', 1, 'reps', 8, 'weight', 100)));
  assert (select business_id from public.workout_logs where id = v) = 'b3000000-0000-0000-0000-000000000001', 'log carries business';
  assert (select count(*) from public.set_logs where workout_log_id = v) = 1, 'sets logged';

  -- Missing business id: rejected.
  begin
    perform public.log_workout(jsonb_build_object('performed_on', '2030-01-02'), '[]'::jsonb);
    raise exception 'expected not_a_client (no business)';
  exception when insufficient_privilege then null; end;

  -- A business they are not a client of: rejected.
  begin
    perform public.log_workout(jsonb_build_object('business_id', 'b3000000-0000-0000-0000-000000000002'), '[]'::jsonb);
    raise exception 'expected not_a_client (other business)';
  exception when insufficient_privilege then null; end;

  -- Client tries to write the coach reply on insert: cleared.
  insert into public.check_ins (business_id, client_id, week_of, wins, coach_response, responded_by)
  values ('b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', '2030-01-07', 'PR!',
          'I am the coach now', 'a3000000-0000-0000-0000-000000000002');
  assert (select coach_response is null and responded_by is null and coach_responded_at is null from public.check_ins
           where client_id = 'c3000000-0000-0000-0000-000000000001'), 'client cannot author a coach reply';

  -- A check-in filed under a business they don't belong to: RLS rejects it.
  begin
    insert into public.check_ins (business_id, client_id, week_of)
    values ('b3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', '2030-01-07');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
end $$;

-- client2 belongs to Gym Two only: cannot log at Gym One.
set local request.jwt.claim.sub = 'c3000000-0000-0000-0000-000000000002';
do $$ begin
  begin
    perform public.log_workout(jsonb_build_object('business_id', 'b3000000-0000-0000-0000-000000000001', 'performed_on', '2030-01-01'),
                               '[]'::jsonb);
    raise exception 'expected not_a_client';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.programs) = 0, 'client2 sees no Gym One programs';
  assert not exists (select 1 from public.exercises where id = 'e3000000-0000-0000-0000-000000000001'),
    'Gym One custom exercise hidden from Gym Two client';
end $$;

-- client3 belongs to both gyms: their Gym One workout cannot be logged under Gym Two,
-- nor can Gym One feedback be filed under Gym Two.
set local request.jwt.claim.sub = 'c3000000-0000-0000-0000-000000000003';
do $$ begin
  begin
    perform public.log_workout(jsonb_build_object('business_id', 'b3000000-0000-0000-0000-000000000002',
                                                  'workout_id', 'd3000000-0000-0000-0000-000000000003'), '[]'::jsonb);
    raise exception 'expected workout_not_assigned';
  exception when insufficient_privilege then null; end;
  -- Nor someone else's workout in the right business.
  begin
    perform public.log_workout(jsonb_build_object('business_id', 'b3000000-0000-0000-0000-000000000001',
                                                  'workout_id', 'd3000000-0000-0000-0000-000000000002'), '[]'::jsonb);
    raise exception 'expected workout_not_assigned (other client)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.program_feedback (business_id, program_id, client_id, overall_rating)
    values ('b3000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', 5);
    raise exception 'expected program_not_assigned';
  exception when insufficient_privilege then null; end;
  insert into public.program_feedback (business_id, program_id, client_id, overall_rating)
  values ('b3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', 4);
  assert (select count(*) from public.programs) = 1, 'client3 sees only their own program';
end $$;

-- ---------------------------------------------------------------------------
-- Coach replies: any staff member of the business can reply; responded_by
-- tracks who did; staff can't touch the client's content; other businesses
-- can't reply at all.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000002';   -- coach A
do $$ begin
  update public.workout_logs set coach_response = 'Nice work', feedback = 'rewritten by coach', pain_flag = true
   where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select responded_by = 'a3000000-0000-0000-0000-000000000002' and coach_responded_at is not null
                 and feedback = 'Felt good' and not pain_flag
            from public.workout_logs where client_id = 'c3000000-0000-0000-0000-000000000001'),
    'coach A reply stamped; client content untouched';
  update public.check_ins set coach_response = 'Great week', responded_by = 'a3000000-0000-0000-0000-000000000003'
   where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select responded_by from public.check_ins where client_id = 'c3000000-0000-0000-0000-000000000001')
         = 'a3000000-0000-0000-0000-000000000002', 'responded_by cannot be spoofed';
  begin
    update public.check_ins set business_id = 'b3000000-0000-0000-0000-000000000002'
     where client_id = 'c3000000-0000-0000-0000-000000000001';
    raise exception 'expected immutable business';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000003';   -- coach B (not the program's coach)
do $$
declare first_at timestamptz;
begin
  select coach_responded_at into first_at from public.workout_logs where client_id = 'c3000000-0000-0000-0000-000000000001';
  -- Touching other columns with an unchanged reply keeps the original author.
  update public.workout_logs set coach_response = coach_response where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select responded_by from public.workout_logs where client_id = 'c3000000-0000-0000-0000-000000000001')
         = 'a3000000-0000-0000-0000-000000000002', 'unchanged reply keeps author';
  update public.workout_logs set coach_response = 'Adding to that: deload next week'
   where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select responded_by from public.workout_logs where client_id = 'c3000000-0000-0000-0000-000000000001')
         = 'a3000000-0000-0000-0000-000000000003', 'coach B now the responder';
  update public.program_feedback set coach_response = 'Thanks!' where client_id = 'c3000000-0000-0000-0000-000000000003';
  assert (select responded_by from public.program_feedback where client_id = 'c3000000-0000-0000-0000-000000000003')
         = 'a3000000-0000-0000-0000-000000000003', 'feedback reply stamped';
  -- Clearing the reply clears who/when.
  update public.check_ins set coach_response = null where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select responded_by is null and coach_responded_at is null from public.check_ins
           where client_id = 'c3000000-0000-0000-0000-000000000001'), 'cleared reply clears author';

  -- Any staff member can edit a program another coach wrote.
  update public.programs set description = 'Edited by B' where id = 'f3000000-0000-0000-0000-000000000002';
  assert (select description from public.programs where id = 'f3000000-0000-0000-0000-000000000002') = 'Edited by B',
    'shared program editing';
end $$;

-- Gym Two's owner sees and changes nothing at Gym One.
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000004';
do $$
declare n int;
begin
  assert (select count(*) from public.workout_logs) = 0, 'other business sees no logs';
  assert (select count(*) from public.programs) = 0, 'other business sees no programs';
  update public.workout_logs set coach_response = 'hijack' where client_id = 'c3000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'other business cannot reply';
  begin
    perform public.assign_program('f3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002', '2030-02-01');
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null; end;
end $$;

-- Client sees the reply and who wrote it (as staff of their business); can't overwrite it.
set local request.jwt.claim.sub = 'c3000000-0000-0000-0000-000000000001';
do $$ begin
  update public.workout_logs set coach_response = 'client edit', feedback = 'Felt great actually'
   where client_id = 'c3000000-0000-0000-0000-000000000001';
  assert (select coach_response = 'Adding to that: deload next week' and feedback = 'Felt great actually'
            from public.workout_logs where client_id = 'c3000000-0000-0000-0000-000000000001'),
    'client edits own content only';
  assert exists (select 1 from public.workout_logs l join public.profiles p on p.id = l.responded_by
                  where l.client_id = 'c3000000-0000-0000-0000-000000000001'
                    and p.id = 'a3000000-0000-0000-0000-000000000003'), 'client can see who replied';
end $$;

-- ---------------------------------------------------------------------------
-- assign_program stays inside the template's business.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000005';   -- dual: coach at both gyms
do $$
declare v uuid;
begin
  -- client2 is only Gym Two's client: a Gym One template can't go to them,
  -- even though this coach works at both.
  begin
    perform public.assign_program('f3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000002', '2030-02-01');
    raise exception 'expected not_a_client';
  exception when insufficient_privilege then null; end;
  -- Assigning within Gym One lands in Gym One with this coach responsible.
  v := public.assign_program('f3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000003', '2030-02-01');
  assert (select business_id = 'b3000000-0000-0000-0000-000000000001' and coach_id = 'a3000000-0000-0000-0000-000000000005'
                 and client_id = 'c3000000-0000-0000-0000-000000000003' and template_id = 'f3000000-0000-0000-0000-000000000001'
            from public.programs where id = v), 'assigned copy belongs to the template business';
  assert (select count(*) from public.workout_exercises we join public.program_workouts w on w.id = we.workout_id
           where w.program_id = v) = 1, 'workouts cloned';
  -- Staff can't attach a client of another business to a program directly either.
  begin
    insert into public.programs (business_id, coach_id, client_id, name)
    values ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000002', 'Sneaky');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Exercise library: global + own business; custom exercises editable by its staff only.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a3000000-0000-0000-0000-000000000004';   -- Gym Two owner
do $$
declare n int;
begin
  assert exists (select 1 from public.exercises where business_id is null), 'global library visible';
  assert not exists (select 1 from public.exercises where id = 'e3000000-0000-0000-0000-000000000001'), 'Gym One exercise hidden';
  update public.exercises set name = 'x' where business_id is null;
  get diagnostics n = row_count;
  assert n = 0, 'global library read-only';
  begin
    insert into public.exercises (business_id, name) values ('b3000000-0000-0000-0000-000000000001', 'Planted');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
  insert into public.exercises (business_id, name) values ('b3000000-0000-0000-0000-000000000002', 'Gym Two Carry');
end $$;

set local request.jwt.claim.sub = 'c3000000-0000-0000-0000-000000000001';   -- Gym One client
do $$ begin
  assert exists (select 1 from public.exercises where id = 'e3000000-0000-0000-0000-000000000001'), 'own business exercise visible';
  assert not exists (select 1 from public.exercises where name = 'Gym Two Carry'), 'other business exercise hidden';
end $$;

rollback;
