-- Training area: integrity guards, transactional builder/logging RPCs and
-- supporting indexes for programming, workout logging, feedback and check-ins.

-- ---------------------------------------------------------------------------
-- Indexes for the feedback loop queries
-- ---------------------------------------------------------------------------
create index if not exists workout_logs_workout_idx on public.workout_logs (workout_id);
create index if not exists program_feedback_client_idx on public.program_feedback (client_id, created_at desc);
create index if not exists check_ins_trainer_week_idx on public.check_ins (trainer_id, week_of desc);
create index if not exists check_ins_client_week_idx on public.check_ins (client_id, week_of desc);
create index if not exists goals_client_idx on public.goals (client_id);
create index if not exists habits_client_idx on public.habits (client_id);
create index if not exists progress_photos_client_idx on public.progress_photos (client_id, taken_on desc);

-- Goals track where they started so progress works in both directions
-- (e.g. body weight going down toward the target).
alter table public.goals add column if not exists start_value numeric;

-- ---------------------------------------------------------------------------
-- Response guards: on workout logs, program feedback and check-ins the client
-- owns the content and the trainer owns trainer_response. RLS lets both
-- sides update the row, so a trigger enforces the column split. Service-role
-- writes (auth.uid() is null) are trusted.
-- ---------------------------------------------------------------------------
create or replace function public.guard_trainer_response() returns trigger
language plpgsql set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v jsonb;
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.client_id = v_uid then
      new.trainer_response := null;
      new.trainer_responded_at := null;
    elsif new.trainer_response is not null then
      new.trainer_responded_at := coalesce(new.trainer_responded_at, now());
    end if;
    return new;
  end if;

  if new.client_id is distinct from old.client_id then
    raise exception 'client_id is immutable' using errcode = '42501';
  end if;

  if old.client_id = v_uid then
    -- Client edits content; the coach's reply is untouchable.
    new.trainer_response := old.trainer_response;
    new.trainer_responded_at := old.trainer_responded_at;
    return new;
  end if;

  -- Trainer: only the response columns change.
  v := to_jsonb(old) || jsonb_build_object(
    'trainer_response', new.trainer_response,
    'trainer_responded_at',
      case when new.trainer_response is distinct from old.trainer_response
           then case when new.trainer_response is null then null else now() end
           else old.trainer_responded_at end
  );
  new := jsonb_populate_record(new, v);
  return new;
end $$;

create trigger workout_logs_guard_response before insert or update on public.workout_logs
  for each row execute function public.guard_trainer_response();
create trigger program_feedback_guard_response before insert or update on public.program_feedback
  for each row execute function public.guard_trainer_response();
create trigger check_ins_guard_response before insert or update on public.check_ins
  for each row execute function public.guard_trainer_response();

-- A workout log may only reference a workout from the client's own program.
create or replace function public.check_workout_log_workout() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.workout_id is not null and (tg_op = 'INSERT' or new.workout_id is distinct from old.workout_id) then
    if not exists (
      select 1 from public.program_workouts w join public.programs p on p.id = w.program_id
       where w.id = new.workout_id and p.client_id = new.client_id
    ) then
      raise exception 'workout_not_assigned' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger workout_logs_check_workout before insert or update on public.workout_logs
  for each row execute function public.check_workout_log_workout();

-- Program feedback only from the program's own client.
create or replace function public.check_program_feedback_client() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.programs p where p.id = new.program_id and p.client_id = new.client_id) then
    raise exception 'program_not_assigned' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger program_feedback_check_client before insert on public.program_feedback
  for each row execute function public.check_program_feedback_client();

-- ---------------------------------------------------------------------------
-- assign_program: also require that the client belongs to the calling trainer
-- and that the source is a template (security definer bypasses the RLS
-- check on programs.client_id).
-- ---------------------------------------------------------------------------
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
  if auth.uid() is not null then
    if t.trainer_id <> auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not exists (select 1 from public.trainer_clients tc
                    where tc.trainer_id = t.trainer_id and tc.client_id = p_client) then
      raise exception 'not_your_client' using errcode = '42501';
    end if;
  end if;

  insert into public.programs (trainer_id, client_id, template_id, name, description, goal, duration_weeks, start_date, status)
  values (t.trainer_id, p_client, t.id, t.name, t.description, t.goal, t.duration_weeks, p_start, 'active')
  returning id into v_new;

  for w in select * from public.program_workouts where program_id = t.id order by week, day, sort_order loop
    insert into public.program_workouts (program_id, week, day, name, notes, estimated_minutes, sort_order)
    values (v_new, w.week, w.day, w.name, w.notes, w.estimated_minutes, w.sort_order)
    returning id into v_w;
    insert into public.workout_exercises (workout_id, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes)
    select v_w, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes
      from public.workout_exercises where workout_id = w.id;
  end loop;

  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Builder RPCs (security invoker: RLS applies, so only the owning trainer
-- can write).
-- ---------------------------------------------------------------------------

-- Copy one workout (with its exercises) to a week/day of the same program.
create or replace function public.duplicate_program_workout(
  p_workout uuid, p_week int, p_day int
) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  w public.program_workouts;
  v_new uuid;
begin
  select * into w from public.program_workouts where id = p_workout;
  if not found then raise exception 'workout_not_found'; end if;
  insert into public.program_workouts (program_id, week, day, name, notes, estimated_minutes, sort_order)
  values (w.program_id, p_week, p_day, w.name, w.notes, w.estimated_minutes,
          coalesce((select max(sort_order) + 1 from public.program_workouts
                     where program_id = w.program_id and week = p_week and day = p_day), 0))
  returning id into v_new;
  insert into public.workout_exercises (workout_id, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes)
  select v_new, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes
    from public.workout_exercises where workout_id = p_workout;
  return v_new;
end $$;

-- Copy every workout of one week into other weeks ("copy week 1 to 2-4").
-- With p_replace the target weeks are cleared first. Returns workouts created.
create or replace function public.copy_program_week(
  p_program uuid, p_from_week int, p_to_weeks int[], p_replace boolean default true
) returns int
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_week int;
  w record;
  v_count int := 0;
  v_duration int;
begin
  select duration_weeks into v_duration from public.programs where id = p_program;
  if not found then raise exception 'program_not_found'; end if;
  foreach v_week in array p_to_weeks loop
    if v_week = p_from_week then continue; end if;
    if v_week < 1 or v_week > v_duration then raise exception 'week_out_of_range'; end if;
    if p_replace then
      delete from public.program_workouts where program_id = p_program and week = v_week;
    end if;
    for w in select id, day from public.program_workouts
              where program_id = p_program and week = p_from_week order by day, sort_order loop
      perform public.duplicate_program_workout(w.id, v_week, w.day);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- Copy a program (template or a client's copy) into a new template.
create or replace function public.duplicate_program(p_program uuid, p_name text) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  t public.programs;
  v_new uuid;
  w record;
  v_w uuid;
begin
  select * into t from public.programs where id = p_program;
  if not found then raise exception 'program_not_found'; end if;
  insert into public.programs (trainer_id, client_id, template_id, name, description, goal, duration_weeks, status)
  values (t.trainer_id, null, null, coalesce(nullif(trim(p_name), ''), t.name || ' (copy)'),
          t.description, t.goal, t.duration_weeks, 'draft')
  returning id into v_new;
  for w in select * from public.program_workouts where program_id = t.id order by week, day, sort_order loop
    insert into public.program_workouts (program_id, week, day, name, notes, estimated_minutes, sort_order)
    values (v_new, w.week, w.day, w.name, w.notes, w.estimated_minutes, w.sort_order)
    returning id into v_w;
    insert into public.workout_exercises (workout_id, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes)
    select v_w, exercise_id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes
      from public.workout_exercises where workout_id = w.id;
  end loop;
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Logging: workout log + its sets in one transaction, as the signed-in client.
-- p_log: { workout_id?, performed_on?, duration_minutes?, session_rpe?,
--          difficulty_rating?, enjoyment_rating?, energy_level?, pain_flag?, feedback? }
-- p_sets: [{ exercise_id, workout_exercise_id?, set_number, reps?, weight?,
--            weight_unit?, duration_seconds?, rpe?, completed?, notes? }]
-- ---------------------------------------------------------------------------
create or replace function public.log_workout(p_log jsonb, p_sets jsonb) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_sets, '[]'::jsonb)) <> 'array' then raise exception 'invalid_sets'; end if;

  insert into public.workout_logs (
    client_id, workout_id, performed_on, duration_minutes, session_rpe, difficulty_rating,
    enjoyment_rating, energy_level, pain_flag, feedback
  ) values (
    v_uid,
    nullif(p_log ->> 'workout_id', '')::uuid,
    coalesce(nullif(p_log ->> 'performed_on', '')::date, current_date),
    nullif(p_log ->> 'duration_minutes', '')::int,
    nullif(p_log ->> 'session_rpe', '')::numeric,
    nullif(p_log ->> 'difficulty_rating', '')::smallint,
    nullif(p_log ->> 'enjoyment_rating', '')::smallint,
    nullif(p_log ->> 'energy_level', '')::smallint,
    coalesce((p_log ->> 'pain_flag')::boolean, false),
    nullif(trim(p_log ->> 'feedback'), '')
  ) returning id into v_id;

  insert into public.set_logs (
    workout_log_id, workout_exercise_id, exercise_id, set_number, reps, weight, weight_unit,
    duration_seconds, rpe, completed, notes
  )
  select v_id,
         nullif(s ->> 'workout_exercise_id', '')::uuid,
         (s ->> 'exercise_id')::uuid,
         (s ->> 'set_number')::int,
         nullif(s ->> 'reps', '')::int,
         nullif(s ->> 'weight', '')::numeric,
         coalesce(nullif(s ->> 'weight_unit', ''), 'lb'),
         nullif(s ->> 'duration_seconds', '')::int,
         nullif(s ->> 'rpe', '')::numeric,
         coalesce((s ->> 'completed')::boolean, true),
         nullif(trim(s ->> 'notes'), '')
    from jsonb_array_elements(coalesce(p_sets, '[]'::jsonb)) s;

  -- Prescribed-exercise ids must belong to the logged workout.
  if exists (
    select 1 from public.set_logs sl
     where sl.workout_log_id = v_id and sl.workout_exercise_id is not null
       and not exists (select 1 from public.workout_exercises we
                        where we.id = sl.workout_exercise_id
                          and we.workout_id is not distinct from nullif(p_log ->> 'workout_id', '')::uuid)
  ) then
    raise exception 'set_not_in_workout';
  end if;

  return v_id;
end $$;

-- Exercises a client may log must be visible to them (global or their trainer's).
create or replace function public.check_set_log_exercise() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if auth.uid() is not null and not exists (select 1 from public.exercises e where e.id = new.exercise_id) then
    raise exception 'exercise_not_visible' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger set_logs_check_exercise before insert or update on public.set_logs
  for each row execute function public.check_set_log_exercise();

-- RPCs that act "as the caller" are not for anonymous use (assign_program skips
-- its ownership checks when auth.uid() is null, which is meant for the service role).
do $$
declare f text;
begin
  foreach f in array array[
    'public.log_workout(jsonb, jsonb)',
    'public.duplicate_program_workout(uuid, int, int)',
    'public.copy_program_week(uuid, int, int[], boolean)',
    'public.duplicate_program(uuid, text)',
    'public.assign_program(uuid, uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
