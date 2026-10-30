-- Training: exercise library, programs, workout logging, feedback, check-ins
-- and progress tracking. All client data is per business.

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,   -- null = global library
  name text not null,
  category text,
  primary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  instructions text,
  coaching_cues text[] not null default '{}',
  demo_video_url text,
  thumbnail_url text,
  is_unilateral boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.exercises (business_id, name);
create trigger exercises_updated before update on public.exercises
  for each row execute function public.set_updated_at();

-- client_id null = reusable template; otherwise that client's assigned copy.
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete set null,        -- author / responsible coach
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
create index on public.programs (business_id, client_id);
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
  superset_group text,
  sets int not null default 3 check (sets between 1 and 20),
  reps text,
  load text,
  rest_seconds int,
  tempo text,
  notes text
);
create index on public.workout_exercises (workout_id, sort_order);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  workout_id uuid references public.program_workouts (id) on delete set null,
  performed_on date not null default current_date,
  duration_minutes int,
  session_rpe numeric(3, 1) check (session_rpe between 1 and 10),
  difficulty_rating smallint check (difficulty_rating between 1 and 5),
  enjoyment_rating smallint check (enjoyment_rating between 1 and 5),
  energy_level smallint check (energy_level between 1 and 5),
  pain_flag boolean not null default false,
  feedback text,
  coach_response text,
  coach_responded_at timestamptz,
  responded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.workout_logs (business_id, client_id, performed_on desc);
create index on public.workout_logs (workout_id);
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

create table public.program_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  program_id uuid not null references public.programs (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  week int,
  overall_rating smallint check (overall_rating between 1 and 5),
  difficulty text check (difficulty in ('too_easy', 'just_right', 'too_hard')),
  volume text check (volume in ('too_little', 'just_right', 'too_much')),
  favorite_parts text,
  least_favorite_parts text,
  requested_changes text,
  coach_response text,
  coach_responded_at timestamptz,
  responded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.program_feedback (program_id);
create index on public.program_feedback (client_id, created_at desc);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
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
  coach_response text,
  coach_responded_at timestamptz,
  responded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, client_id, week_of)
);
create index on public.check_ins (business_id, week_of desc);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
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
create index on public.body_metrics (business_id, client_id, measured_on desc);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  taken_on date not null default current_date,
  pose text check (pose in ('front', 'side', 'back', 'other')),
  storage_path text not null check (split_part(storage_path, '/', 1) = client_id::text),
  created_at timestamptz not null default now()
);
create index on public.progress_photos (business_id, client_id, taken_on desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  metric text,
  start_value numeric,
  target_value numeric,
  current_value numeric,
  unit text,
  target_date date,
  achieved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.goals (business_id, client_id);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  name text not null,
  target_per_week int not null default 7 check (target_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.habits (business_id, client_id);

create table public.habit_logs (
  habit_id uuid not null references public.habits (id) on delete cascade,
  logged_on date not null,
  primary key (habit_id, logged_on)
);

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------
-- On logs, program feedback and check-ins the client owns the content and the
-- business's staff own the coach reply. RLS lets both sides update the row;
-- this trigger enforces the split. Service-role writes are trusted.
create or replace function public.guard_coach_response() returns trigger
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
      new.coach_response := null;
      new.coach_responded_at := null;
      new.responded_by := null;
    elsif new.coach_response is not null then
      new.coach_responded_at := coalesce(new.coach_responded_at, now());
      new.responded_by := v_uid;
    end if;
    return new;
  end if;

  if new.client_id is distinct from old.client_id or new.business_id is distinct from old.business_id then
    raise exception 'client_id and business_id are immutable' using errcode = '42501';
  end if;

  if old.client_id = v_uid then
    new.coach_response := old.coach_response;
    new.coach_responded_at := old.coach_responded_at;
    new.responded_by := old.responded_by;
    return new;
  end if;

  -- Staff: only the reply columns change.
  v := to_jsonb(old) || jsonb_build_object(
    'coach_response', new.coach_response,
    'coach_responded_at', case when new.coach_response is distinct from old.coach_response
                               then case when new.coach_response is null then null else now() end
                               else old.coach_responded_at end,
    'responded_by', case when new.coach_response is distinct from old.coach_response
                         then case when new.coach_response is null then null else v_uid end
                         else old.responded_by end
  );
  new := jsonb_populate_record(new, v);
  return new;
end $$;

create trigger workout_logs_guard_response before insert or update on public.workout_logs
  for each row execute function public.guard_coach_response();
create trigger program_feedback_guard_response before insert or update on public.program_feedback
  for each row execute function public.guard_coach_response();
create trigger check_ins_guard_response before insert or update on public.check_ins
  for each row execute function public.guard_coach_response();

-- A log may only reference a workout from the client's own program in that business.
create or replace function public.check_workout_log_workout() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.workout_id is not null and (tg_op = 'INSERT' or new.workout_id is distinct from old.workout_id) then
    if not exists (
      select 1 from public.program_workouts w join public.programs p on p.id = w.program_id
       where w.id = new.workout_id and p.client_id = new.client_id and p.business_id = new.business_id
    ) then
      raise exception 'workout_not_assigned' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger workout_logs_check_workout before insert or update on public.workout_logs
  for each row execute function public.check_workout_log_workout();

create or replace function public.check_program_feedback_client() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.programs p
                  where p.id = new.program_id and p.client_id = new.client_id and p.business_id = new.business_id) then
    raise exception 'program_not_assigned' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger program_feedback_check_client before insert on public.program_feedback
  for each row execute function public.check_program_feedback_client();

-- Exercises a client logs must be visible to them (global or their business's).
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

-- ---------------------------------------------------------------------------
-- Program RPCs
-- ---------------------------------------------------------------------------
-- Copy a template to a client of the same business (caller must be staff).
create or replace function public.assign_program(p_template uuid, p_client uuid, p_start date)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.programs;
  v_new uuid;
  w record;
  v_w uuid;
begin
  select * into t from public.programs where id = p_template;
  if not found then raise exception 'program_not_found'; end if;
  if auth.uid() is not null and not public.is_member(t.business_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.business_clients bc
                  where bc.business_id = t.business_id and bc.client_id = p_client) then
    raise exception 'not_a_client' using errcode = '42501';
  end if;

  insert into public.programs (business_id, coach_id, client_id, template_id, name, description, goal, duration_weeks, start_date, status)
  values (t.business_id, coalesce(auth.uid(), t.coach_id), p_client, t.id, t.name, t.description, t.goal,
          t.duration_weeks, p_start, 'active')
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

-- Builder RPCs run as the caller (RLS applies).
create or replace function public.duplicate_program_workout(p_workout uuid, p_week int, p_day int) returns uuid
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
  insert into public.programs (business_id, coach_id, client_id, template_id, name, description, goal, duration_weeks, status)
  values (t.business_id, auth.uid(), null, null, coalesce(nullif(trim(p_name), ''), t.name || ' (copy)'),
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

-- Log a workout and its sets in one transaction, as the signed-in client of
-- p_log.business_id. Shapes as before plus business_id.
create or replace function public.log_workout(p_log jsonb, p_sets jsonb) returns uuid
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_business uuid := (p_log ->> 'business_id')::uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if v_business is null or not public.is_client_of(v_business) then
    raise exception 'not_a_client' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_sets, '[]'::jsonb)) <> 'array' then raise exception 'invalid_sets'; end if;

  insert into public.workout_logs (
    business_id, client_id, workout_id, performed_on, duration_minutes, session_rpe, difficulty_rating,
    enjoyment_rating, energy_level, pain_flag, feedback
  ) values (
    v_business, v_uid,
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
