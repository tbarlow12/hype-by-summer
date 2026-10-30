-- A program may only use global exercises or its own business's custom ones
-- (blocks staff of two businesses from mixing libraries through the raw API).
create or replace function public.check_workout_exercise_scope() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_program_business uuid;
  v_exercise_business uuid;
begin
  select p.business_id into v_program_business
    from public.program_workouts w join public.programs p on p.id = w.program_id
   where w.id = new.workout_id;
  select business_id into v_exercise_business from public.exercises where id = new.exercise_id;
  if v_exercise_business is not null and v_exercise_business <> v_program_business then
    raise exception 'exercise_not_in_business' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger workout_exercises_scope before insert or update of exercise_id, workout_id on public.workout_exercises
  for each row execute function public.check_workout_exercise_scope();
