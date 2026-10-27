-- Payments area: Stripe sync status for offerings, digital product storage,
-- credit reporting/adjustment RPCs.

-- ---------------------------------------------------------------------------
-- Offerings: Stripe sync bookkeeping
-- ---------------------------------------------------------------------------
alter table public.offerings
  add column if not exists stripe_synced_at timestamptz,
  add column if not exists stripe_sync_error text,
  add column if not exists digital_file_name text;

create index if not exists payments_booking_idx on public.payments (booking_id) where booking_id is not null;
create index if not exists payments_subscription_idx on public.payments (subscription_id) where subscription_id is not null;
create index if not exists payments_trainer_paid_idx on public.payments (trainer_id, paid_at desc) where paid_at is not null;
create index if not exists subscriptions_trainer_idx on public.subscriptions (trainer_id, status);
create index if not exists credit_ledger_payment_idx on public.credit_ledger (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------------------
-- Credits: remaining balance per grant (for billing pages / reports)
-- ---------------------------------------------------------------------------
-- Remaining credits on every unexpired grant for a client. Callable by the
-- client themself, their trainer, or the service role (auth.uid() is null).
create or replace function public.credit_grants_remaining(p_client uuid, p_trainer uuid default null)
returns table (
  grant_id uuid,
  trainer_id uuid,
  granted int,
  remaining int,
  reason text,
  offering_id uuid,
  session_type_ids uuid[],
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and auth.uid() <> p_client and not public.is_trainer_of(p_client) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select g.id, g.trainer_id, g.delta,
           (g.delta - coalesce((select -sum(d.delta) from public.credit_ledger d where d.grant_id = g.id), 0))::int,
           g.reason, g.offering_id, g.session_type_ids, g.expires_at, g.created_at
      from public.credit_ledger g
     where g.client_id = p_client
       and (p_trainer is null or g.trainer_id = p_trainer)
       and g.delta > 0
       and (g.expires_at is null or g.expires_at > now())
       and (auth.uid() is null or auth.uid() = p_client or g.trainer_id = auth.uid()
            or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
     order by g.expires_at nulls last, g.created_at;
end $$;

-- Unused, unexpired credits a trainer still owes across all clients.
create or replace function public.outstanding_credits(p_trainer uuid) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v int;
begin
  if auth.uid() is not null and auth.uid() <> p_trainer
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(g.delta - coalesce(u.used, 0)), 0)::int into v
    from public.credit_ledger g
    left join lateral (
      select -sum(d.delta) as used from public.credit_ledger d where d.grant_id = g.id
    ) u on true
   where g.trainer_id = p_trainer and g.delta > 0
     and (g.expires_at is null or g.expires_at > now());
  return v;
end $$;

-- Remove credits FIFO (earliest expiry first) from any of the client's grants
-- (or only the grants of one payment). Used for manual negative adjustments
-- and for clawing back unused credits when a purchase is refunded. Returns the
-- number of credits actually removed (never more than are available).
create or replace function public.debit_credits(
  p_client uuid,
  p_trainer uuid,
  p_amount int,
  p_reason text,
  p_note text default null,
  p_created_by uuid default null,
  p_payment uuid default null
) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  remaining int := p_amount;
  g record;
  take int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_client::text, 0));
  for g in
    select l.id, l.delta - coalesce((select -sum(d.delta) from public.credit_ledger d where d.grant_id = l.id), 0) as available
      from public.credit_ledger l
     where l.client_id = p_client and l.trainer_id = p_trainer and l.delta > 0
       and (l.expires_at is null or l.expires_at > now())
       and (p_payment is null or l.payment_id = p_payment)
     order by l.expires_at nulls last, l.created_at
  loop
    exit when remaining <= 0;
    continue when g.available <= 0;
    take := least(g.available, remaining);
    insert into public.credit_ledger (client_id, trainer_id, delta, reason, grant_id, note, created_by)
    values (p_client, p_trainer, -take, p_reason, g.id, p_note, p_created_by);
    remaining := remaining - take;
  end loop;
  return p_amount - remaining;
end $$;

revoke execute on function public.debit_credits from public, anon, authenticated;
revoke execute on function public.outstanding_credits from public, anon;
revoke execute on function public.credit_grants_remaining from public, anon;
grant execute on function public.outstanding_credits to authenticated, service_role;
grant execute on function public.credit_grants_remaining to authenticated, service_role;
grant execute on function public.debit_credits to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for paid digital products (served via signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('digital-products', 'digital-products', false, 524288000)   -- 500 MB
on conflict (id) do nothing;

create policy "trainer manages digital products" on storage.objects for all
  using (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_staff())
  with check (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_staff());
