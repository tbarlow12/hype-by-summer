-- Platform: trainer signup via create_business, admin stats, suspension.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-000000000001', 'owner.p@example.com', '{"full_name":"Owner P"}'),
  ('70000000-0000-0000-0000-000000000002', 'owner.q@example.com', '{"full_name":"Owner Q"}'),
  ('70000000-0000-0000-0000-000000000003', 'client.p@example.com', '{"full_name":"Client P"}');

-- Signup: the owner creates their business, then sets the brand color as themselves.
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001';
select set_config('test.biz_p', (public.create_business('Peak-Fit', 'Peak Fit', 'Europe/London')).id::text, true) is not null as _p \gset
do $$ begin
  update public.businesses set brand_color = '#2563eb' where id = current_setting('test.biz_p')::uuid;
  assert (select brand_color from public.businesses where id = current_setting('test.biz_p')::uuid) = '#2563eb',
    'owner can set their brand color';
  assert (select slug from public.businesses where id = current_setting('test.biz_p')::uuid) = 'peak-fit', 'slug lowercased';
  -- Taken slug.
  begin
    perform public.create_business('peak-fit', 'Copy', 'UTC');
    raise exception 'expected unique violation';
  exception when unique_violation then null; end;
  -- Stats are not for tenants.
  begin
    perform 1 from public.platform_business_stats();
    raise exception 'expected stats to be denied';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002';
select set_config('test.biz_q', (public.create_business('quad-squad', 'Quad Squad', '')).id::text, true) is not null as _q \gset
do $$ begin
  -- Q can't touch P.
  update public.businesses set name = 'Hacked' where id = current_setting('test.biz_p')::uuid;
  assert (select count(*) from public.businesses) = 1, 'owners see only their own business';
end $$;
reset role;
set local request.jwt.claim.sub = '';

do $$
declare
  p uuid := current_setting('test.biz_p')::uuid;
  q uuid := current_setting('test.biz_q')::uuid;
  s record;
begin
  assert (select name from public.businesses where id = p) = 'Peak Fit', 'other owners cannot rename';
  assert (select timezone from public.businesses where id = q) = 'America/Denver', 'empty timezone defaults';
  insert into public.business_clients (business_id, client_id) values (p, '70000000-0000-0000-0000-000000000003');
  insert into public.payments (business_id, purpose, status, amount_cents, amount_refunded_cents, paid_at) values
    (p, 'booking', 'succeeded', 10000, 0, now()),
    (p, 'package', 'partially_refunded', 20000, 5000, now()),
    (p, 'booking', 'failed', 99900, 0, null),
    (q, 'booking', 'pending', 5000, 0, null);
  insert into public.platform_fees (id, business_id, stripe_account_id, amount_cents, amount_refunded_cents) values
    ('fee_1', p, 'acct_p', 300, 0), ('fee_2', p, 'acct_p', 600, 150);

  select * into s from public.platform_business_stats() where business_id = p;
  assert s.members = 1 and s.clients = 1, format('counts %s/%s', s.members, s.clients);
  assert s.processed_cents = 30000 and s.refunded_cents = 5000, format('processed %s refunded %s', s.processed_cents, s.refunded_cents);
  assert s.fees_cents = 900 and s.fees_refunded_cents = 150, 'fees summed';
  assert s.last_paid_at is not null, 'last paid';
  select * into s from public.platform_business_stats() where business_id = q;
  assert s.processed_cents = 0 and s.fees_cents = 0 and s.clients = 0, 'no money yet';
end $$;

-- Service role (admin client) can read stats.
set local role service_role;
do $$ begin
  assert (select count(*) from public.platform_business_stats()) >= 2, 'service role reads stats';
end $$;
reset role;

rollback;
