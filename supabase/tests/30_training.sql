-- Training: builder RPCs, workout logging, response guards and RLS.
-- Everything runs in a transaction that is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'coach30@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'client30@example.com', '{"full_name":"Client B"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'other30@example.com', '{"full_name":"Client C"}');
-- The trainer role is only automatic for the very first account.
update public.profiles set role = 'trainer' where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.trainer_clients (trainer_id, client_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');

create temporary table t30 (k text primary key, v uuid);
grant all on t30 to authenticated;

-- Trainer builds a template and copies week 1 to weeks 2-4.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  prog uuid; w1 uuid; w2 uuid; dup uuid; copy uuid; assigned uuid; n int;
  squat uuid := (select id from public.exercises where name = 'Back Squat' and trainer_id is null);
  bench uuid := (select id from public.exercises where name = 'Bench Press' and trainer_id is null);
begin
  insert into public.programs (trainer_id, name, duration_weeks) values (auth.uid(), 'Base', 4) returning id into prog;
  insert into public.program_workouts (program_id, week, day, name) values (prog, 1, 1, 'Lower') returning id into w1;
  insert into public.program_workouts (program_id, week, day, name) values (prog, 1, 3, 'Upper') returning id into w2;
  insert into public.workout_exercises (workout_id, exercise_id, sets, reps, sort_order) values
    (w1, squat, 3, '5', 0), (w2, bench, 4, '8-10', 0);

  assert public.copy_program_week(prog, 1, array[2, 3, 4]) = 6, 'six workouts copied';
  assert (select count(*) from public.program_workouts where program_id = prog) = 8, 'eight workouts total';
  assert (select count(*) from public.workout_exercises we join public.program_workouts pw on pw.id = we.workout_id
           where pw.program_id = prog and pw.week = 3) = 2, 'exercises copied with workouts';
  -- Replace mode clears the target week first.
  perform public.copy_program_week(prog, 1, array[2]);
  assert (select count(*) from public.program_workouts where program_id = prog and week = 2) = 2, 'replace keeps week 2 at 2';
  begin
    perform public.copy_program_week(prog, 1, array[9]);
    raise exception 'expected week_out_of_range';
  exception when others then assert sqlerrm = 'week_out_of_range', sqlerrm; end;

  dup := public.duplicate_program_workout(w1, 1, 5);
  assert (select day from public.program_workouts where id = dup) = 5, 'workout duplicated to day 5';
  assert (select count(*) from public.workout_exercises where workout_id = dup) = 1, 'duplicated exercises';

  -- Template copy.
  copy := public.duplicate_program(prog, 'Base v2');
  n := (select count(*) from public.program_workouts where program_id = copy);
  assert n = 9, 'program duplicated, got ' || n;

  -- Assign to a client that is ours; refuse a stranger.
  assigned := public.assign_program(prog, '00000000-0000-0000-0000-0000000000b1', '2030-01-07');
  assert (select status from public.programs where id = assigned) = 'active', 'assigned program active';
  begin
    perform public.assign_program(prog, '00000000-0000-0000-0000-0000000000c1', '2030-01-07');
    raise exception 'expected not_your_client';
  exception when others then assert sqlerrm = 'not_your_client', sqlerrm; end;

  insert into t30 values ('assigned', assigned), ('template', prog),
    ('aw1', (select id from public.program_workouts where program_id = assigned and week = 1 and day = 1)),
    ('tw1', w1);
end $$;

-- Client logs a workout from their program.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$
declare
  aw1 uuid := (select v from t30 where k = 'aw1');
  we uuid := (select id from public.workout_exercises where workout_id = (select v from t30 where k = 'aw1'));
  squat uuid := (select id from public.exercises where name = 'Back Squat' and trainer_id is null);
  log uuid;
begin
  log := public.log_workout(
    jsonb_build_object('workout_id', aw1, 'performed_on', '2030-01-07', 'session_rpe', 8,
                       'difficulty_rating', 5, 'pain_flag', true, 'feedback', 'Knee felt off'),
    jsonb_build_array(
      jsonb_build_object('exercise_id', squat, 'workout_exercise_id', we, 'set_number', 1, 'reps', 5, 'weight', 185),
      jsonb_build_object('exercise_id', squat, 'workout_exercise_id', we, 'set_number', 2, 'reps', 5, 'weight', 195)));
  assert (select count(*) from public.set_logs where workout_log_id = log) = 2, 'two sets logged';
  assert (select pain_flag from public.workout_logs where id = log), 'pain flag stored';
  insert into t30 values ('log', log);

  -- Freestyle (no workout) is fine.
  perform public.log_workout(jsonb_build_object('feedback', 'Extra run'), '[]'::jsonb);

  -- Cannot log against the trainer's template workout.
  begin
    perform public.log_workout(jsonb_build_object('workout_id', (select v from t30 where k = 'tw1')), '[]'::jsonb);
    raise exception 'expected workout_not_assigned';
  exception when others then assert sqlerrm in ('workout_not_assigned'), sqlerrm; end;

  -- A client cannot write the coach's response.
  update public.workout_logs set trainer_response = 'self-praise', feedback = 'Knee felt off (edited)' where id = log;
  assert (select trainer_response from public.workout_logs where id = log) is null, 'client cannot set response';
  assert (select feedback from public.workout_logs where id = log) = 'Knee felt off (edited)', 'client edits own feedback';

  -- Check-ins: a client can't pre-fill the coach's reply.
  insert into public.check_ins (client_id, trainer_id, week_of, sleep_quality, trainer_response)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000a1', '2030-01-07', 4, 'fake reply');
  assert (select trainer_response from public.check_ins where client_id = auth.uid()) is null, 'check-in reply stripped';

  insert into public.program_feedback (program_id, client_id, week, overall_rating, difficulty)
  values ((select v from t30 where k = 'assigned'), auth.uid(), 1, 4, 'too_hard');
  begin
    insert into public.program_feedback (program_id, client_id, overall_rating)
    values ((select v from t30 where k = 'template'), auth.uid(), 4);
    raise exception 'expected rejection';
  exception when others then assert sqlerrm <> 'expected rejection', 'feedback on template rejected'; end;
end $$;

-- Trainer responds; can't rewrite the client's words.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare log uuid := (select v from t30 where k = 'log');
begin
  assert (select count(*) from public.set_logs where workout_log_id = log) = 2, 'trainer reads sets';
  update public.workout_logs set trainer_response = 'Deload next week', feedback = 'tampered', pain_flag = false where id = log;
  assert (select trainer_response from public.workout_logs where id = log) = 'Deload next week', 'response saved';
  assert (select trainer_responded_at from public.workout_logs where id = log) is not null, 'responded_at stamped';
  assert (select feedback from public.workout_logs where id = log) = 'Knee felt off (edited)', 'feedback untouched';
  assert (select pain_flag from public.workout_logs where id = log), 'pain flag untouched';
  update public.program_feedback set trainer_response = 'Will adjust' where client_id = '00000000-0000-0000-0000-0000000000b1';
  assert (select trainer_response from public.program_feedback limit 1) = 'Will adjust', 'feedback response saved';
  update public.check_ins set trainer_response = 'Great week', sleep_quality = 1 where trainer_id = auth.uid();
  assert (select sleep_quality from public.check_ins where trainer_id = auth.uid()) = 4, 'trainer cannot edit ratings';
  assert (select trainer_response from public.check_ins where trainer_id = auth.uid()) = 'Great week', 'check-in reply saved';
end $$;

-- Another client sees none of it and cannot use the builder RPCs on it.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select count(*) from public.workout_logs) = 0, 'C sees no logs';
  assert (select count(*) from public.set_logs) = 0, 'C sees no sets';
  assert (select count(*) from public.program_feedback) = 0, 'C sees no feedback';
  begin
    perform public.copy_program_week((select v from t30 where k = 'template'), 1, array[2]);
    raise exception 'expected failure';
  exception when others then assert sqlerrm <> 'expected failure', 'C cannot copy weeks'; end;
end $$;

rollback;
