-- Clients area: roster credit summary, intake ownership, waiver stamping.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a0', 'coach60@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-0000000006b0', 'client60b@example.com', '{"full_name":"Client B"}'),
  ('00000000-0000-0000-0000-0000000006c0', 'client60c@example.com', '{"full_name":"Client C"}');

do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000006a0';
  cb uuid := '00000000-0000-0000-0000-0000000006b0';
  cc uuid := '00000000-0000-0000-0000-0000000006c0';
  g uuid;
begin
  -- The seed may already contain a trainer; make sure ours is one.
  update public.profiles set role = 'trainer' where id = t;
  insert into public.trainer_profiles (trainer_id, slug, business_name) values (t, 'coach-60', 'Coach 60');
  insert into public.trainer_clients (trainer_id, client_id) values (t, cb), (t, cc);

  insert into public.credit_ledger (client_id, trainer_id, delta, reason) values (cb, t, 5, 'purchase') returning id into g;
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, grant_id) values (cb, t, -4, 'booking', g);
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, expires_at)
  values (cb, t, 3, 'purchase', now() - interval '1 day');   -- expired
end $$;

-- Trainer: roster balances.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a0';
do $$
declare r record;
begin
  select * into r from public.trainer_client_credit_balances('00000000-0000-0000-0000-0000000006a0')
   where client_id = '00000000-0000-0000-0000-0000000006b0';
  assert r.balance = 1, 'B has 1 usable credit, got ' || r.balance;
  assert r.granted = 8, 'B was granted 8 in total, got ' || r.granted;
  select * into r from public.trainer_client_credit_balances('00000000-0000-0000-0000-0000000006a0')
   where client_id = '00000000-0000-0000-0000-0000000006c0';
  assert r.balance = 0 and r.granted = 0, 'C never bought credits';
end $$;

-- Client B: cannot read another trainer's roster; intake + waiver rules.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006b0';
do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000006a0';
  cb uuid := '00000000-0000-0000-0000-0000000006b0';
  cc uuid := '00000000-0000-0000-0000-0000000006c0';
  i public.client_intakes;
  first_stamp timestamptz;
begin
  begin
    perform * from public.trainer_client_credit_balances(t);
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null;
  end;

  -- Intake with a trainer B doesn't train with is rejected.
  begin
    insert into public.client_intakes (client_id, trainer_id) values (cb, cc);
    raise exception 'expected RLS violation';
  exception when insufficient_privilege then null;
  end;

  -- Client-supplied acceptance time is ignored; signing stamps now().
  insert into public.client_intakes (client_id, trainer_id, primary_goal, waiver_signature, waiver_version, waiver_accepted_at)
  values (cb, t, 'strength', 'Client B', 'v1', '2000-01-01') returning * into i;
  assert i.waiver_accepted_at = now(), 'acceptance stamped by db';
  first_stamp := i.waiver_accepted_at;

  -- Editing other fields keeps the stamp, even if the client tries to move it.
  update public.client_intakes set injuries = 'Left knee', waiver_accepted_at = '2001-01-01'
   where client_id = cb returning * into i;
  assert i.waiver_accepted_at = first_stamp, 'stamp preserved on unrelated edit';

  -- Clearing the signature clears acceptance.
  update public.client_intakes set waiver_signature = '  ' where client_id = cb returning * into i;
  assert i.waiver_accepted_at is null and i.waiver_signature is null and i.waiver_version is null, 'cleared';

  -- Unsigned intake has no acceptance.
  update public.client_intakes set waiver_accepted_at = now() where client_id = cb returning * into i;
  assert i.waiver_accepted_at is null, 'cannot accept without a signature';
end $$;

-- Trainer reads the intake read-only.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000006a0';
do $$ begin
  assert (select count(*) from public.client_intakes where client_id = '00000000-0000-0000-0000-0000000006b0') = 1,
    'trainer reads client intake';
  update public.client_intakes set injuries = 'tampered' where client_id = '00000000-0000-0000-0000-0000000006b0';
  assert (select injuries from public.client_intakes where client_id = '00000000-0000-0000-0000-0000000006b0') = 'Left knee',
    'trainer cannot edit intake';
end $$;

rollback;
