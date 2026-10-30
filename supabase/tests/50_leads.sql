-- Leads under multi-business: capture + assignment, unsubscribe scoping, magnet stats.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-000000000001', 'owner.la@example.com', '{"full_name":"Owner LA"}'),
  ('a5000000-0000-0000-0000-000000000002', 'coach1.la@example.com', '{"full_name":"Coach One"}'),
  ('a5000000-0000-0000-0000-000000000003', 'coach2.la@example.com', '{"full_name":"Coach Two"}'),
  ('a5000000-0000-0000-0000-000000000004', 'front.la@example.com', '{"full_name":"Front Desk"}'),
  ('b5000000-0000-0000-0000-000000000001', 'owner.lb@example.com', '{"full_name":"Owner LB"}');

set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-000000000001';
select set_config('test.la', (public.create_business('leads-a', 'Leads A', 'America/Denver')).id::text, true) is not null as _a \gset
set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-000000000001';
select set_config('test.lb', (public.create_business('leads-b', 'Leads B', 'America/Denver')).id::text, true) is not null as _b \gset
reset role;
set local request.jwt.claim.sub = '';

do $$
declare
  a uuid := current_setting('test.la')::uuid;
  b uuid := current_setting('test.lb')::uuid;
  oa uuid := 'a5000000-0000-0000-0000-000000000001';
  c1 uuid := 'a5000000-0000-0000-0000-000000000002';
  c2 uuid := 'a5000000-0000-0000-0000-000000000003';
  fd uuid := 'a5000000-0000-0000-0000-000000000004';
  ob uuid := 'b5000000-0000-0000-0000-000000000001';
  ma uuid; mb uuid;
  l1 public.leads; l2 public.leads; l3 public.leads; l4 public.leads; lb public.leads; x public.leads;
  seen uuid[];
begin
  -- Team A: owner + coach1 (bookable), coach2 not bookable, front desk staff.
  insert into public.business_members (business_id, user_id, role, slug, is_bookable, created_at) values
    (a, c1, 'coach', 'coach-one', true, now() + interval '1 second'),
    (a, c2, 'coach', 'coach-two', false, now() + interval '2 seconds'),
    (a, fd, 'staff', null, true, now() + interval '3 seconds');
  insert into public.lead_magnets (business_id, slug, title) values (a, 'guide', 'A guide') returning id into ma;
  insert into public.lead_magnets (business_id, slug, title) values (b, 'guide', 'B guide') returning id into mb;

  -- Round-robin among bookable owner/admin/coach (never staff, never non-bookable).
  l1 := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'one@example.com', 'source', 'lead_magnet', 'lead_magnet_id', ma));
  l2 := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'two@example.com'));
  seen := array[l1.assigned_coach_id, l2.assigned_coach_id];
  assert oa = any (seen) and c1 = any (seen) and l1.assigned_coach_id <> l2.assigned_coach_id,
    format('first two leads go to the two bookable coaches, got %s', seen);
  l3 := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'three@example.com'));
  assert l3.assigned_coach_id = l1.assigned_coach_id, 'round-robin wraps to the least recently assigned';

  -- Explicit coach (e.g. the consult's coach) wins, even if not bookable.
  l4 := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'four@example.com', 'assigned_coach_id', c2, 'source', 'booking'));
  assert l4.assigned_coach_id = c2, 'explicit assignee kept';
  -- A coach from another business is ignored (falls back to round-robin).
  x := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'five@example.com', 'assigned_coach_id', ob));
  assert x.assigned_coach_id in (oa, c1), 'foreign assignee ignored';
  -- Repeat submission keeps the current coach.
  x := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'FOUR@example.com', 'assigned_coach_id', c1));
  assert x.id = l4.id and x.assigned_coach_id = c2, 'repeat keeps assignee';

  -- Magnets never cross businesses.
  assert l1.lead_magnet_id = ma, 'own magnet attributed';
  lb := public.capture_lead(jsonb_build_object('business_id', b, 'email', 'one@example.com', 'source', 'lead_magnet', 'lead_magnet_id', ma));
  assert lb.lead_magnet_id is null and lb.business_id = b, 'foreign magnet dropped';
  assert lb.assigned_coach_id = ob, 'solo business: owner gets every lead';
  assert (select detail ->> 'lead_magnet_id' from public.lead_events where lead_id = lb.id and type = 'captured') is null,
    'event carries no foreign magnet';
  begin
    perform public.capture_lead(jsonb_build_object('email', 'nobiz@example.com'));
    raise exception 'expected business_required';
  exception when others then assert sqlerrm = 'business_required', sqlerrm; end;

  -- No bookable coaches: the owner.
  update public.business_members set is_bookable = false where business_id = a;
  x := public.capture_lead(jsonb_build_object('business_id', a, 'email', 'six@example.com'));
  assert x.assigned_coach_id = oa, 'falls back to owner';
  update public.business_members set is_bookable = true where business_id = a and user_id in (oa, c1);

  -- Assignees must belong to the lead's business.
  begin
    update public.leads set assigned_coach_id = ob where id = l1.id;
    raise exception 'expected assignee_not_member';
  exception when check_violation then null; end;
  update public.leads set assigned_coach_id = fd where id = l1.id;

  -- Unsubscribe is scoped to the business serving the link.
  assert public.unsubscribe_lead(l2.unsubscribe_token, b) is null, 'other business cannot unsubscribe';
  assert (select unsubscribed_at from public.leads where id = l2.id) is null, 'still subscribed';
  x := public.unsubscribe_lead(l2.unsubscribe_token, a);
  assert x.unsubscribed_at is not null and x.status = 'unsubscribed' and not x.marketing_consent, 'unsubscribed';
  x := public.unsubscribe_lead(l2.unsubscribe_token, a);
  assert (select count(*) from public.lead_events where lead_id = l2.id and type = 'unsubscribed') = 1, 'idempotent';
  assert (select unsubscribed_at from public.leads where id = lb.id) is null, 'same email at B untouched';

  -- Stats inputs: a download for A's magnet and a converted lead.
  insert into public.lead_events (lead_id, type, detail) values
    (l1.id, 'magnet_downloaded', jsonb_build_object('lead_magnet_id', ma)),
    (l1.id, 'magnet_downloaded', jsonb_build_object('lead_magnet_id', ma));
  update public.leads set status = 'converted' where id = l1.id;
  perform set_config('test.ma', ma::text, true);
  perform set_config('test.mb', mb::text, true);
end $$;

-- Magnet stats run under RLS: each business only sees its own funnel.
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-0000-0000-000000000002';
do $$
declare
  s jsonb := public.lead_magnet_stats(current_setting('test.la')::uuid);
begin
  assert jsonb_array_length(s) = 1, 'one magnet for A';
  assert (s -> 0 ->> 'lead_magnet_id') = current_setting('test.ma'), 'A magnet';
  assert (s -> 0 ->> 'leads')::int = 1 and (s -> 0 ->> 'downloads')::int = 2
     and (s -> 0 ->> 'unique_downloads')::int = 1 and (s -> 0 ->> 'converted')::int = 1, s::text;
  assert jsonb_array_length(public.lead_magnet_stats(current_setting('test.lb')::uuid)) = 0, 'A staff sees no B stats';
  assert (select count(*) from public.leads) = 6, 'A staff sees all A leads, none of B';
  assert (select count(*) from public.leads where assigned_coach_id = 'a5000000-0000-0000-0000-000000000002') >= 1, 'my leads';
end $$;

set local request.jwt.claim.sub = 'b5000000-0000-0000-0000-000000000001';
do $$
begin
  assert (select count(*) from public.leads) = 1, 'B sees only its lead';
  assert jsonb_array_length(public.lead_magnet_stats(current_setting('test.la')::uuid)) = 0, 'B sees no A stats';
  begin
    perform public.capture_lead(jsonb_build_object('business_id', current_setting('test.la'), 'email', 'x@example.com'));
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
  begin
    perform public.unsubscribe_lead('nope', null);
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
