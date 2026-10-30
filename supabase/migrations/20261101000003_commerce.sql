-- Commerce: offerings, subscriptions, payments, session credits, Stripe
-- bookkeeping and platform fees. Money is collected on each business's Stripe
-- Connect account; payments record the coach for commission reporting.

create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.offering_kind not null,
  name text not null,
  description text,
  features text[] not null default '{}',
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'usd',
  billing_interval public.billing_interval,
  interval_count int not null default 1 check (interval_count >= 1),
  trial_days int not null default 0 check (trial_days >= 0),
  credits int not null default 0 check (credits >= 0),         -- per purchase / per period
  credits_expire_days int check (credits_expire_days > 0),
  session_type_ids uuid[],                                     -- credits valid for (null = any)
  includes_messaging boolean not null default true,
  includes_programming boolean not null default false,
  digital_file_path text,
  digital_file_name text,
  stripe_product_id text unique,
  stripe_price_id text unique,
  stripe_synced_at timestamptz,
  stripe_sync_error text,
  active boolean not null default true,
  featured boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'subscription') = (billing_interval is not null))
);
create index on public.offerings (business_id, active);
create trigger offerings_updated before update on public.offerings
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete set null,
  offering_id uuid references public.offerings (id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null,                                       -- mirrors Stripe
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.subscriptions (business_id, status);
create index on public.subscriptions (client_id);
create trigger subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  coach_id uuid references public.profiles (id) on delete set null,   -- commission attribution
  payer_email citext,
  purpose public.payment_purpose not null,
  status public.payment_status not null default 'pending',
  amount_cents int not null,
  amount_refunded_cents int not null default 0,
  platform_fee_cents int not null default 0,
  currency text not null default 'usd',
  description text,
  booking_id uuid references public.bookings (id) on delete set null,
  offering_id uuid references public.offerings (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  stripe_account_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text unique,
  stripe_charge_id text,
  receipt_url text,
  hosted_invoice_url text,
  metadata jsonb not null default '{}',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.payments (business_id, created_at desc);
create index on public.payments (business_id, paid_at desc) where paid_at is not null;
create index on public.payments (business_id, coach_id, paid_at desc);
create index on public.payments (client_id, created_at desc);
create index on public.payments (booking_id) where booking_id is not null;
create index on public.payments (subscription_id) where subscription_id is not null;
create trigger payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- Session credits: grants (delta > 0) and debits (delta < 0) pointing at the
-- grant they consume. Credits belong to the business, usable with any coach.
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null,         -- purchase, subscription_renewal, booking, refund, adjustment, expiry
  offering_id uuid references public.offerings (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  session_type_ids uuid[],
  expires_at timestamptz,
  grant_id uuid references public.credit_ledger (id) on delete set null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.credit_ledger (business_id, client_id);
create index on public.credit_ledger (grant_id);
create index on public.credit_ledger (payment_id) where payment_id is not null;
create unique index credit_ledger_payment_grant on public.credit_ledger (payment_id)
  where delta > 0 and payment_id is not null;

-- Processed Stripe webhook events (idempotency + audit). account = connected
-- account the event came from (null for platform events).
create table public.stripe_events (
  id text primary key,
  type text not null,
  account text,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);

-- Application fees the platform earned (Starter plan).
create table public.platform_fees (
  id text primary key,                         -- Stripe application fee id
  business_id uuid references public.businesses (id) on delete set null,
  stripe_account_id text not null,
  amount_cents int not null,
  amount_refunded_cents int not null default 0,
  currency text not null default 'usd',
  charge_id text,
  created_at timestamptz not null default now()
);
create index on public.platform_fees (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Credit functions
-- ---------------------------------------------------------------------------
-- Usable balance for a session type: unexpired grants minus their debits.
-- Callers may ask about themselves or a client of a business they staff.
create or replace function public.credit_balance(
  p_client uuid, p_business uuid, p_session_type uuid default null
) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and auth.uid() <> p_client
     and not public.is_member(p_business) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(sum(g.delta - coalesce(used.amount, 0)), 0)::int
      from public.credit_ledger g
      left join lateral (
        select -sum(d.delta) as amount from public.credit_ledger d where d.grant_id = g.id
      ) used on true
     where g.client_id = p_client and g.business_id = p_business and g.delta > 0
       and (g.expires_at is null or g.expires_at > now())
       and (p_session_type is null or g.session_type_ids is null or p_session_type = any (g.session_type_ids))
  );
end $$;

-- Consume credits FIFO by expiry. Raises if insufficient.
create or replace function public.consume_credits(
  p_client uuid, p_business uuid, p_session_type uuid, p_amount int, p_booking uuid
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  remaining int := p_amount;
  g record;
  take int;
begin
  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_client::text, 0));
  for g in
    select l.id, l.delta - coalesce((select -sum(d.delta) from public.credit_ledger d where d.grant_id = l.id), 0) as available
      from public.credit_ledger l
     where l.client_id = p_client and l.business_id = p_business and l.delta > 0
       and (l.expires_at is null or l.expires_at > now())
       and (l.session_type_ids is null or p_session_type = any (l.session_type_ids))
     order by l.expires_at nulls last, l.created_at
  loop
    exit when remaining <= 0;
    continue when g.available <= 0;
    take := least(g.available, remaining);
    insert into public.credit_ledger (business_id, client_id, delta, reason, booking_id, grant_id)
    values (p_business, p_client, -take, 'booking', p_booking, g.id);
    remaining := remaining - take;
  end loop;
  if remaining > 0 then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;
end $$;

-- Return credits spent on a booking: the debits are removed so the original
-- grants (and expiries) are restored.
create or replace function public.refund_booking_credits(p_booking uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_total int := 0;
begin
  with del as (
    delete from public.credit_ledger where booking_id = p_booking and reason = 'booking' returning delta
  )
  select coalesce(-sum(delta), 0) into v_total from del;
  return v_total;
end $$;

-- Remove credits FIFO from a client's grants (optionally only one payment's),
-- for manual adjustments and refund clawbacks. Returns credits removed.
create or replace function public.debit_credits(
  p_client uuid, p_business uuid, p_amount int, p_reason text,
  p_note text default null, p_created_by uuid default null, p_payment uuid default null
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
     where l.client_id = p_client and l.business_id = p_business and l.delta > 0
       and (l.expires_at is null or l.expires_at > now())
       and (p_payment is null or l.payment_id = p_payment)
     order by l.expires_at nulls last, l.created_at
  loop
    exit when remaining <= 0;
    continue when g.available <= 0;
    take := least(g.available, remaining);
    insert into public.credit_ledger (business_id, client_id, delta, reason, grant_id, note, created_by)
    values (p_business, p_client, -take, p_reason, g.id, p_note, p_created_by);
    remaining := remaining - take;
  end loop;
  return p_amount - remaining;
end $$;

-- Remaining credits per unexpired grant (billing pages, client hub).
create or replace function public.credit_grants_remaining(p_client uuid, p_business uuid)
returns table (
  grant_id uuid, granted int, remaining int, reason text, offering_id uuid,
  session_type_ids uuid[], expires_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and auth.uid() <> p_client
     and not public.is_member(p_business) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select g.id, g.delta,
           (g.delta - coalesce((select -sum(d.delta) from public.credit_ledger d where d.grant_id = g.id), 0))::int,
           g.reason, g.offering_id, g.session_type_ids, g.expires_at, g.created_at
      from public.credit_ledger g
     where g.client_id = p_client and g.business_id = p_business and g.delta > 0
       and (g.expires_at is null or g.expires_at > now())
     order by g.expires_at nulls last, g.created_at;
end $$;

-- Unused, unexpired credits the business still owes across all clients.
create or replace function public.outstanding_credits(p_business uuid) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v int;
begin
  if auth.uid() is not null and not public.is_member(p_business) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(g.delta - coalesce(u.used, 0)), 0)::int into v
    from public.credit_ledger g
    left join lateral (select -sum(d.delta) as used from public.credit_ledger d where d.grant_id = g.id) u on true
   where g.business_id = p_business and g.delta > 0 and (g.expires_at is null or g.expires_at > now());
  return v;
end $$;

-- Credit summary for every client of a business (roster, "low credits").
-- granted = all-time credits, so "ran out" differs from "never bought".
create or replace function public.client_credit_balances(p_business uuid)
returns table (client_id uuid, balance int, granted int)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and not public.is_member(p_business) and not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select bc.client_id,
           public.credit_balance(bc.client_id, p_business, null),
           coalesce((select sum(l.delta) from public.credit_ledger l
                      where l.client_id = bc.client_id and l.business_id = p_business and l.delta > 0), 0)::int
      from public.business_clients bc
     where bc.business_id = p_business;
end $$;
