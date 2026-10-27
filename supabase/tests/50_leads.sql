-- Leads & marketing: capture_lead v2 (first/last touch), unsubscribe_lead,
-- lead_magnet_stats and RLS on the stats. Rolled back at the end.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'coach50@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-0000000005b1', 'client50@example.com', '{"full_name":"Client"}');

do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000005a1';
  c uuid := '00000000-0000-0000-0000-0000000005b1';
  m uuid; m2 uuid; consult uuid;
  l public.leads; l2 public.leads; s jsonb; row jsonb;
begin
  -- Another trainer may already exist in this DB; make sure ours is a trainer.
  update public.profiles set role = 'trainer' where id = t;
  insert into public.trainer_profiles (trainer_id, slug, business_name) values (t, 'coach-fifty', 'Coach 50');
  insert into public.lead_magnets (trainer_id, slug, title) values (t, 'guide-fifty', 'Guide') returning id into m;
  insert into public.lead_magnets (trainer_id, slug, title) values (t, 'guide-fifty-two', 'Guide 2') returning id into m2;
  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents, is_consultation, requires_payment)
  values (t, 'consult-50', 'Free consult', 20, 0, true, false) returning id into consult;

  -- First touch is stored; last touch is recorded separately.
  l := public.capture_lead(jsonb_build_object(
    'trainer_id', t, 'email', 'Amy@Example.com', 'first_name', 'Amy', 'source', 'lead_magnet',
    'lead_magnet_id', m, 'utm_source', 'instagram', 'utm_campaign', 'spring',
    'landing_page', '/free/guide-fifty', 'first_seen_at', '2026-01-01T00:00:00Z',
    'ip_address', '203.0.113.9', 'country', 'US', 'marketing_consent', true, 'consent_text', 'Yes please',
    'last_touch', jsonb_build_object('utm_source', 'instagram', 'utm_campaign', 'spring')));
  assert l.email = 'amy@example.com' and l.lead_magnet_id = m and l.marketing_consent, 'lead created';
  assert l.first_seen_at = '2026-01-01T00:00:00Z', 'first_seen_at from cookie';
  assert l.consented_at is not null and l.consent_text = 'Yes please', 'consent stored';
  assert l.last_touch ->> 'utm_campaign' = 'spring', 'last touch stored';
  assert l.ip_address = '203.0.113.9'::inet and l.country = 'US', 'request metadata stored';

  -- Repeat submission from another campaign: first touch kept, last touch updated, gaps filled.
  l := public.capture_lead(jsonb_build_object(
    'trainer_id', t, 'email', 'amy@example.com', 'source', 'contact_form', 'city', 'Denver',
    'utm_source', 'google', 'utm_campaign', 'fall', 'timeline', 'asap',
    'last_touch', jsonb_build_object('utm_source', 'google', 'utm_campaign', 'fall')));
  assert l.utm_source = 'instagram' and l.utm_campaign = 'spring', 'first touch kept';
  assert l.last_touch ->> 'utm_campaign' = 'fall', 'last touch updated';
  assert l.city = 'Denver' and l.timeline = 'asap' and l.first_name = 'Amy', 'merged';
  assert l.lead_magnet_id = m, 'magnet attribution kept';
  assert (select count(*) from public.lead_events where lead_id = l.id and type = 'captured') = 2, 'two captures';

  -- Unsubscribe by token: once-only event, consent cleared, unknown token -> null.
  l2 := public.unsubscribe_lead(l.unsubscribe_token);
  assert l2.status = 'unsubscribed' and not l2.marketing_consent and l2.unsubscribed_at is not null, 'unsubscribed';
  l2 := public.unsubscribe_lead(l.unsubscribe_token);
  assert (select count(*) from public.lead_events where lead_id = l.id and type = 'unsubscribed') = 1, 'one unsub event';
  assert (public.unsubscribe_lead('nope')).id is null, 'unknown token';

  -- Re-capturing without consent keeps them unsubscribed from marketing (but reopens the lead).
  l2 := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'amy@example.com', 'source', 'contact_form'));
  assert not l2.marketing_consent and l2.unsubscribed_at is not null and l2.status = 'new', 'no silent re-consent';
  -- Opting in again clears the unsubscribe.
  l2 := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'amy@example.com', 'marketing_consent', true));
  assert l2.marketing_consent and l2.unsubscribed_at is null, 're-consent';

  -- Converted leads keep their status when unsubscribing.
  l2 := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'bo@example.com', 'source', 'lead_magnet', 'lead_magnet_id', m));
  update public.leads set status = 'converted', converted_client_id = c where id = l2.id;
  l2 := public.unsubscribe_lead(l2.unsubscribe_token);
  assert l2.status = 'converted' and not l2.marketing_consent, 'converted stays converted';

  -- A third lead books a consult; downloads are counted.
  l2 := public.capture_lead(jsonb_build_object('trainer_id', t, 'email', 'cy@example.com', 'source', 'lead_magnet', 'lead_magnet_id', m));
  perform public.reserve_booking(consult, '2030-03-04 16:00Z', null, 'Cy', 'cy@example.com', null, 'confirmed', 'free', 15, null);
  update public.bookings set lead_id = l2.id where guest_email = 'cy@example.com';
  insert into public.lead_events (lead_id, type, detail) values
    (l.id, 'magnet_downloaded', jsonb_build_object('lead_magnet_id', m)),
    (l.id, 'magnet_downloaded', jsonb_build_object('lead_magnet_id', m)),
    (l2.id, 'magnet_downloaded', jsonb_build_object('lead_magnet_id', m));

  s := public.lead_magnet_stats(t);
  assert jsonb_array_length(s) = 2, 'one row per magnet';
  select x into row from jsonb_array_elements(s) x where x ->> 'lead_magnet_id' = m::text;
  assert (row ->> 'leads')::int = 3, 'three leads for magnet, got ' || (row ->> 'leads');
  assert (row ->> 'downloads')::int = 3 and (row ->> 'unique_downloads')::int = 2, 'downloads counted';
  assert (row ->> 'converted')::int = 1, 'one converted';
  assert (row ->> 'consults')::int = 1, 'one consult, got ' || (row ->> 'consults');
  select x into row from jsonb_array_elements(s) x where x ->> 'lead_magnet_id' = m2::text;
  assert (row ->> 'leads')::int = 0 and (row ->> 'downloads')::int = 0, 'empty magnet';
end $$;

-- RLS: a client calling the stats function counts nothing; anon cannot call the RPCs.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000005b1';
do $$
declare s jsonb;
begin
  s := public.lead_magnet_stats('00000000-0000-0000-0000-0000000005a1');
  assert coalesce(jsonb_array_length(s), 0) = 2, 'active magnets are public';
  assert (select sum((x ->> 'leads')::int) from jsonb_array_elements(s) x) = 0, 'client sees no lead counts';
  begin
    perform public.unsubscribe_lead('x');
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.capture_lead('{}'::jsonb);
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000005a1';
do $$
declare s jsonb;
begin
  s := public.lead_magnet_stats('00000000-0000-0000-0000-0000000005a1');
  assert (select sum((x ->> 'leads')::int) from jsonb_array_elements(s) x) = 3, 'trainer sees own counts';
end $$;

rollback;
