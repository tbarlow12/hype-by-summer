-- Cross-area guards added during integration.
begin;
insert into public.businesses (id, slug, name) values
  ('d1000000-0000-0000-0000-000000000001', 'biz-x', 'X'),
  ('d1000000-0000-0000-0000-000000000002', 'biz-y', 'Y');
do $$
declare px uuid; wx uuid; ex_y uuid; ex_global uuid;
begin
  insert into public.programs (business_id, name) values ('d1000000-0000-0000-0000-000000000001', 'P') returning id into px;
  insert into public.program_workouts (program_id, week, day, name) values (px, 1, 1, 'W') returning id into wx;
  insert into public.exercises (business_id, name) values ('d1000000-0000-0000-0000-000000000002', 'Y custom') returning id into ex_y;
  select id into ex_global from public.exercises where business_id is null limit 1;
  insert into public.workout_exercises (workout_id, exercise_id) values (wx, ex_global);
  begin
    insert into public.workout_exercises (workout_id, exercise_id) values (wx, ex_y);
    raise exception 'expected exercise_not_in_business';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
