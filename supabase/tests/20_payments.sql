-- Payments: who sees which payments, the commission report, and the
-- service-role-only Stripe bookkeeping.
begin;

insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'owner.pay@example.com'),
  ('a2000000-0000-0000-0000-000000000002', 'coach1.pay@example.com'),
  ('a2000000-0000-0000-0000-000000000003', 'coach2.pay@example.com'),
  ('a2000000-0000-0000-0000-000000000004', 'owner2.pay@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'client.pay@example.com');
insert into public.businesses (id, slug, name, stripe_account_id, plan, platform_fee_bps) values
  ('b2000000-0000-0000-0000-000000000001', 'pay-one', 'Pay One', 'acct_one', 'starter', 300),
  ('b2000000-0000-0000-0000-000000000002', 'pay-two', 'Pay Two', 'acct_two', 'pro', 300);
insert into public.business_members (business_id, user_id, role) values
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'owner'),
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'coach'),
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000003', 'coach'),
  ('b2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000004', 'owner');
insert into public.business_clients (business_id, client_id, primary_coach_id) values
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002');

-- Business one: coach1 $100 (refunded $40, fee $3) + $50; coach2 $200; unassigned $10;
-- a pending and an out-of-range payment that the report ignores. Business two: $999.
insert into public.payments (business_id, client_id, coach_id, purpose, status, amount_cents, amount_refunded_cents, platform_fee_cents, paid_at) values
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'package', 'partially_refunded', 10000, 4000, 300, '2026-10-05'),
  ('b2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', 'booking', 'succeeded', 5000, 0, 150, '2026-10-06'),
  ('b2000000-0000-0000-0000-000000000001', null, 'a2000000-0000-0000-0000-000000000003', 'booking', 'succeeded', 20000, 0, 600, '2026-10-07'),
  ('b2000000-0000-0000-0000-000000000001', null, null, 'one_time', 'succeeded', 1000, 0, 30, '2026-10-08'),
  ('b2000000-0000-0000-0000-000000000001', null, 'a2000000-0000-0000-0000-000000000003', 'booking', 'pending', 7000, 0, 0, null),
  ('b2000000-0000-0000-0000-000000000001', null, 'a2000000-0000-0000-0000-000000000003', 'booking', 'succeeded', 7000, 0, 0, '2026-09-01'),
  ('b2000000-0000-0000-0000-000000000002', null, null, 'booking', 'succeeded', 99900, 0, 0, '2026-10-05');
insert into public.stripe_events (id, type, account, payload) values ('evt_1', 'charge.refunded', 'acct_one', '{}');
insert into public.platform_fees (id, business_id, stripe_account_id, amount_cents) values ('fee_1', 'b2000000-0000-0000-0000-000000000001', 'acct_one', 300);

set local role authenticated;

-- Owner sees all of business one's payments and the full report.
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000001';
do $$
declare r record;
begin
  assert (select count(*) from public.payments) = 6, 'owner sees all six of their payments, none of business two';
  assert (select count(*) from public.coach_revenue_report('b2000000-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01')) = 3,
    'coach1, coach2, unassigned';
  select * into r from public.coach_revenue_report('b2000000-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01')
   where coach_id = 'a2000000-0000-0000-0000-000000000002';
  assert r.payments = 2 and r.gross_cents = 15000 and r.refunded_cents = 4000 and r.net_cents = 11000 and r.platform_fee_cents = 450,
    'coach1 totals';
  assert (select net_cents from public.coach_revenue_report('b2000000-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01')
           where coach_id is null) = 1000, 'unassigned totals';
  assert (select count(*) from public.coach_revenue_report('b2000000-0000-0000-0000-000000000002', '2026-10-01', '2026-11-01')) = 0,
    'nothing from another business';
end $$;

-- A coach sees only payments attributed to them.
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000002';
do $$
begin
  assert (select count(*) from public.payments) = 2, 'coach1 sees own two payments';
  assert (select count(*) from public.coach_revenue_report('b2000000-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01')) = 1,
    'coach report is just them';
end $$;

-- The client sees their own payments only.
set local request.jwt.claim.sub = 'c2000000-0000-0000-0000-000000000001';
do $$
begin
  assert (select count(*) from public.payments) = 2, 'client sees own two';
  assert (select count(*) from public.coach_revenue_report('b2000000-0000-0000-0000-000000000001', '2026-10-01', '2026-11-01')) = 1,
    'client report only covers their own rows (RLS)';
  assert (select count(*) from public.stripe_events) = 0, 'stripe_events hidden';
  assert (select count(*) from public.platform_fees) = 0, 'platform_fees hidden';
end $$;

-- Stripe/plan columns on businesses are not readable or writable by app users.
set local request.jwt.claim.sub = 'a2000000-0000-0000-0000-000000000001';
do $$
begin
  begin
    perform stripe_account_id from public.businesses;
    raise exception 'expected column privilege error';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.businesses set plan = 'pro' where id = 'b2000000-0000-0000-0000-000000000001';
    raise exception 'expected column privilege error';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments (business_id, purpose, amount_cents) values ('b2000000-0000-0000-0000-000000000001', 'tip', 100);
    raise exception 'expected payments to be service-role only';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
