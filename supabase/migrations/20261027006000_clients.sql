-- Clients & dashboards: roster credit summary, safer intake/waiver writes.

-- Credit summary for every client of a trainer in one round trip (roster,
-- dashboard "low credits"). Only the trainer themself (or an admin / the
-- service role) may ask. `granted` = all-time credits ever granted, so the UI
-- can tell "ran out" apart from "never bought a package".
create or replace function public.trainer_client_credit_balances(p_trainer uuid)
returns table (client_id uuid, balance int, granted int)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and auth.uid() <> p_trainer and not public.current_role_is('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select tc.client_id,
           public.credit_balance(tc.client_id, p_trainer, null),
           coalesce((select sum(l.delta) from public.credit_ledger l
                      where l.client_id = tc.client_id and l.trainer_id = p_trainer and l.delta > 0), 0)::int
      from public.trainer_clients tc
     where tc.trainer_id = p_trainer;
end $$;

revoke execute on function public.trainer_client_credit_balances from public, anon;
grant execute on function public.trainer_client_credit_balances to authenticated, service_role;

-- Clients may only file an intake with a trainer they actually train with.
drop policy if exists "intakes: client own" on public.client_intakes;
create policy "intakes: client own" on public.client_intakes for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid() and public.is_client_of(trainer_id));

-- The waiver acceptance time is stamped by the database, never by the client:
-- (re)signing (new signature or new waiver version) records now(); clearing
-- the signature clears acceptance; any other edit keeps the original stamp.
create or replace function public.client_intakes_stamp_waiver() returns trigger
language plpgsql as $$
begin
  if new.waiver_signature is null or btrim(new.waiver_signature) = '' then
    new.waiver_signature := null;
    new.waiver_accepted_at := null;
    new.waiver_version := null;
  elsif tg_op = 'INSERT'
     or new.waiver_signature is distinct from old.waiver_signature
     or new.waiver_version is distinct from old.waiver_version then
    new.waiver_accepted_at := now();
  else
    new.waiver_accepted_at := old.waiver_accepted_at;
  end if;
  return new;
end $$;

drop trigger if exists client_intakes_waiver on public.client_intakes;
create trigger client_intakes_waiver
  before insert or update on public.client_intakes
  for each row execute function public.client_intakes_stamp_waiver();
