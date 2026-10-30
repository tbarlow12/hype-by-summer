-- Leads: coach assignment + tenant guards.
--
-- Assignment rule (capture_lead):
--   1. An explicit p.assigned_coach_id wins when it's an active member of the
--      business (e.g. the coach a consult was booked with).
--   2. A repeat submission keeps the lead's current coach.
--   3. Otherwise round-robin: the active, bookable owner/admin/coach who was
--      least recently assigned a lead in this business (never-assigned first,
--      then by when they joined). With no bookable coaches it falls back to
--      the business owner.
-- Lead magnets from another business are ignored (attribution never crosses
-- tenants). unsubscribe_lead can be scoped to the business whose site
-- served the link.

create or replace function public.next_lead_coach(p_business uuid) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select m.user_id
       from public.business_members m
      where m.business_id = p_business and m.active and m.is_bookable
        and m.role in ('owner', 'admin', 'coach')
      order by (select max(l.created_at) from public.leads l
                 where l.business_id = p_business and l.assigned_coach_id = m.user_id) asc nulls first,
               m.created_at, m.user_id
      limit 1),
    (select m.user_id from public.business_members m
      where m.business_id = p_business and m.active and m.role = 'owner'
      order by m.created_at limit 1)
  )
$$;

create or replace function public.capture_lead(p jsonb) returns public.leads
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.leads;
  v_is_new boolean;
  v_business uuid := (p ->> 'business_id')::uuid;
  v_consent boolean := coalesce((p ->> 'marketing_consent')::boolean, false);
  v_magnet uuid;
  v_coach uuid;
begin
  if v_business is null then raise exception 'business_required'; end if;
  select id into v_magnet from public.lead_magnets
   where id = (p ->> 'lead_magnet_id')::uuid and business_id = v_business;
  select user_id into v_coach from public.business_members
   where business_id = v_business and user_id = (p ->> 'assigned_coach_id')::uuid and active;

  -- Serialize captures per business so round-robin hands out fairly.
  perform pg_advisory_xact_lock(hashtextextended('capture_lead:' || v_business::text, 0));

  insert into public.leads (
    business_id, assigned_coach_id, email, first_name, last_name, phone, primary_goal, goal_details,
    experience_level, preferred_format, budget_range, timeline, zip_code, city,
    injuries_or_limitations, how_heard, source, lead_magnet_id,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer_url, landing_page, first_seen_at,
    ip_address, user_agent, country, marketing_consent, consent_text, consented_at, last_touch, last_seen_at
  ) values (
    v_business, v_coach, lower(p ->> 'email'), p ->> 'first_name', p ->> 'last_name',
    p ->> 'phone', p ->> 'primary_goal', p ->> 'goal_details', p ->> 'experience_level',
    p ->> 'preferred_format', p ->> 'budget_range', p ->> 'timeline', p ->> 'zip_code', p ->> 'city',
    p ->> 'injuries_or_limitations', p ->> 'how_heard',
    coalesce(p ->> 'source', 'contact_form'), v_magnet,
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_term', p ->> 'utm_content',
    p ->> 'referrer_url', p ->> 'landing_page',
    least(now(), coalesce((p ->> 'first_seen_at')::timestamptz, now())),
    (p ->> 'ip_address')::inet, p ->> 'user_agent', p ->> 'country',
    v_consent, p ->> 'consent_text', case when v_consent then now() end,
    coalesce(p -> 'last_touch', '{}'::jsonb), now()
  )
  on conflict (business_id, email) do update set
    assigned_coach_id = coalesce(leads.assigned_coach_id, excluded.assigned_coach_id),
    first_name = coalesce(excluded.first_name, leads.first_name),
    last_name = coalesce(excluded.last_name, leads.last_name),
    phone = coalesce(excluded.phone, leads.phone),
    primary_goal = coalesce(excluded.primary_goal, leads.primary_goal),
    goal_details = coalesce(excluded.goal_details, leads.goal_details),
    experience_level = coalesce(excluded.experience_level, leads.experience_level),
    preferred_format = coalesce(excluded.preferred_format, leads.preferred_format),
    budget_range = coalesce(excluded.budget_range, leads.budget_range),
    timeline = coalesce(excluded.timeline, leads.timeline),
    zip_code = coalesce(excluded.zip_code, leads.zip_code),
    city = coalesce(excluded.city, leads.city),
    injuries_or_limitations = coalesce(excluded.injuries_or_limitations, leads.injuries_or_limitations),
    how_heard = coalesce(excluded.how_heard, leads.how_heard),
    lead_magnet_id = coalesce(leads.lead_magnet_id, excluded.lead_magnet_id),
    utm_source = coalesce(leads.utm_source, excluded.utm_source),
    utm_medium = coalesce(leads.utm_medium, excluded.utm_medium),
    utm_campaign = coalesce(leads.utm_campaign, excluded.utm_campaign),
    utm_term = coalesce(leads.utm_term, excluded.utm_term),
    utm_content = coalesce(leads.utm_content, excluded.utm_content),
    referrer_url = coalesce(leads.referrer_url, excluded.referrer_url),
    landing_page = coalesce(leads.landing_page, excluded.landing_page),
    first_seen_at = least(leads.first_seen_at, excluded.first_seen_at),
    ip_address = coalesce(excluded.ip_address, leads.ip_address),
    user_agent = coalesce(excluded.user_agent, leads.user_agent),
    country = coalesce(excluded.country, leads.country),
    last_touch = case when excluded.last_touch = '{}'::jsonb then leads.last_touch else excluded.last_touch end,
    last_seen_at = now(),
    marketing_consent = case
      when excluded.marketing_consent then true
      when leads.unsubscribed_at is not null then false
      else leads.marketing_consent end,
    consent_text = coalesce(excluded.consent_text, leads.consent_text),
    consented_at = case when excluded.marketing_consent then coalesce(leads.consented_at, now()) else leads.consented_at end,
    unsubscribed_at = case when excluded.marketing_consent then null else leads.unsubscribed_at end,
    status = case when leads.status in ('lost', 'unsubscribed') then 'new'::public.lead_status else leads.status end,
    lost_reason = case when leads.status = 'lost' then null else leads.lost_reason end,
    score = leads.score + 5
  returning * into l;
  v_is_new := l.created_at = now();

  if l.assigned_coach_id is null then
    update public.leads set assigned_coach_id = public.next_lead_coach(v_business)
     where id = l.id returning * into l;
  end if;

  insert into public.lead_events (lead_id, type, detail)
  values (l.id, 'captured', jsonb_build_object(
    'source', coalesce(p ->> 'source', 'contact_form'), 'lead_magnet_id', v_magnet,
    'utm_source', coalesce(p -> 'last_touch' ->> 'utm_source', p ->> 'utm_source'),
    'utm_campaign', coalesce(p -> 'last_touch' ->> 'utm_campaign', p ->> 'utm_campaign'),
    'landing_page', p ->> 'landing_page', 'repeat', not v_is_new));
  return l;
end $$;

-- Unsubscribe by token; with p_business, only a lead of that business
-- (the site that served the link) can be unsubscribed.
drop function if exists public.unsubscribe_lead(text);
create or replace function public.unsubscribe_lead(p_token text, p_business uuid default null) returns public.leads
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.leads;
  v_was boolean;
begin
  select * into l from public.leads
   where unsubscribe_token = p_token and (p_business is null or business_id = p_business)
   for update;
  if not found then return null; end if;
  v_was := l.unsubscribed_at is not null;
  update public.leads set
    unsubscribed_at = coalesce(unsubscribed_at, now()),
    marketing_consent = false,
    status = case when status = 'converted' then status else 'unsubscribed'::public.lead_status end
  where id = l.id
  returning * into l;
  if not v_was then
    insert into public.lead_events (lead_id, type, detail) values (l.id, 'unsubscribed', jsonb_build_object('via', 'link'));
  end if;
  return l;
end $$;

-- Lead assignees must be staff of the lead's business.
create or replace function public.leads_guard_assignee() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.assigned_coach_id is not null
     and new.assigned_coach_id is distinct from old.assigned_coach_id
     and not exists (select 1 from public.business_members
                      where business_id = new.business_id and user_id = new.assigned_coach_id and active) then
    raise exception 'assignee_not_member' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists leads_guard_assignee on public.leads;
create trigger leads_guard_assignee before insert or update of assigned_coach_id on public.leads
  for each row execute function public.leads_guard_assignee();

do $$
declare f text;
begin
  foreach f in array array[
    'public.capture_lead(jsonb)',
    'public.unsubscribe_lead(text, uuid)',
    'public.next_lead_coach(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
