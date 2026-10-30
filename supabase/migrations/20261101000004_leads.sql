-- Leads & lead magnets (free-guide giveaways), per business.

create table public.lead_magnets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  slug citext not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title text not null,
  subtitle text,
  description text,
  bullet_points text[] not null default '{}',
  file_path text,                     -- storage: lead-magnets/<business_id>/...
  cover_image_url text,
  cta_label text not null default 'Send me the free guide',
  thank_you_message text,
  ask_phone boolean not null default false,
  ask_goal boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug)
);
create trigger lead_magnets_updated before update on public.lead_magnets
  for each row execute function public.set_updated_at();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  assigned_coach_id uuid references public.profiles (id) on delete set null,
  email citext not null,
  first_name text,
  last_name text,
  phone text,
  status public.lead_status not null default 'new',
  -- Qualification
  primary_goal text,
  goal_details text,
  experience_level text,
  preferred_format text,
  preferred_days text[] not null default '{}',
  preferred_times text[] not null default '{}',
  budget_range text,
  timeline text,
  zip_code text,
  city text,
  injuries_or_limitations text,
  how_heard text,
  -- Attribution (first touch in columns, last touch in last_touch)
  source text,
  lead_magnet_id uuid references public.lead_magnets (id) on delete set null,
  referred_by_client_id uuid references public.profiles (id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer_url text,
  landing_page text,
  first_seen_at timestamptz not null default now(),
  last_touch jsonb not null default '{}',
  last_seen_at timestamptz,
  ip_address inet,
  user_agent text,
  country text,
  -- Consent & engagement
  marketing_consent boolean not null default false,
  consent_text text,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  score int not null default 0,
  tags text[] not null default '{}',
  notes text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  converted_client_id uuid references public.profiles (id) on delete set null,
  converted_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, email)
);
create index on public.leads (business_id, status, created_at desc);
create index on public.leads (business_id, next_follow_up_at) where next_follow_up_at is not null;
create trigger leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.bookings
  add constraint bookings_lead_id_fkey foreign key (lead_id) references public.leads (id) on delete set null;

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type public.lead_event_type not null,
  detail jsonb not null default '{}',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.lead_events (lead_id, created_at desc);
create index on public.lead_events ((detail ->> 'lead_magnet_id')) where type in ('captured', 'magnet_downloaded');

-- Upsert a lead from a public form: merges repeat submissions, keeps
-- first-touch attribution, never silently re-opts-in an unsubscribed lead.
create or replace function public.capture_lead(p jsonb) returns public.leads
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.leads;
  v_is_new boolean;
  v_consent boolean := coalesce((p ->> 'marketing_consent')::boolean, false);
begin
  insert into public.leads (
    business_id, email, first_name, last_name, phone, primary_goal, goal_details,
    experience_level, preferred_format, budget_range, timeline, zip_code, city,
    injuries_or_limitations, how_heard, source, lead_magnet_id,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer_url, landing_page, first_seen_at,
    ip_address, user_agent, country, marketing_consent, consent_text, consented_at, last_touch, last_seen_at
  ) values (
    (p ->> 'business_id')::uuid, lower(p ->> 'email'), p ->> 'first_name', p ->> 'last_name',
    p ->> 'phone', p ->> 'primary_goal', p ->> 'goal_details', p ->> 'experience_level',
    p ->> 'preferred_format', p ->> 'budget_range', p ->> 'timeline', p ->> 'zip_code', p ->> 'city',
    p ->> 'injuries_or_limitations', p ->> 'how_heard',
    coalesce(p ->> 'source', 'contact_form'), (p ->> 'lead_magnet_id')::uuid,
    p ->> 'utm_source', p ->> 'utm_medium', p ->> 'utm_campaign', p ->> 'utm_term', p ->> 'utm_content',
    p ->> 'referrer_url', p ->> 'landing_page',
    least(now(), coalesce((p ->> 'first_seen_at')::timestamptz, now())),
    (p ->> 'ip_address')::inet, p ->> 'user_agent', p ->> 'country',
    v_consent, p ->> 'consent_text', case when v_consent then now() end,
    coalesce(p -> 'last_touch', '{}'::jsonb), now()
  )
  on conflict (business_id, email) do update set
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

  insert into public.lead_events (lead_id, type, detail)
  values (l.id, 'captured', jsonb_build_object(
    'source', coalesce(p ->> 'source', 'contact_form'), 'lead_magnet_id', p ->> 'lead_magnet_id',
    'utm_source', coalesce(p -> 'last_touch' ->> 'utm_source', p ->> 'utm_source'),
    'utm_campaign', coalesce(p -> 'last_touch' ->> 'utm_campaign', p ->> 'utm_campaign'),
    'landing_page', p ->> 'landing_page', 'repeat', not v_is_new));
  return l;
end $$;

-- One-click unsubscribe by the lead's secret token. Converted leads keep
-- their status; everyone loses marketing consent.
create or replace function public.unsubscribe_lead(p_token text) returns public.leads
language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.leads;
  v_was boolean;
begin
  select * into l from public.leads where unsubscribe_token = p_token for update;
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

-- Funnel stats per lead magnet. security invoker: RLS decides what counts.
create or replace function public.lead_magnet_stats(p_business uuid) returns jsonb
language sql stable security invoker set search_path = public, extensions as $$
  with magnets as (
    select id from public.lead_magnets where business_id = p_business
  ),
  attributed as (
    select m.id as magnet_id, x.lead_id
      from magnets m
      cross join lateral (
        select e.lead_id from public.lead_events e
         where e.type = 'captured' and e.detail ->> 'lead_magnet_id' = m.id::text
        union
        select l.id from public.leads l where l.lead_magnet_id = m.id
      ) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lead_magnet_id', m.id,
    'leads', (select count(distinct a.lead_id) from attributed a where a.magnet_id = m.id),
    'downloads', (select count(*) from public.lead_events e
                   where e.type = 'magnet_downloaded' and e.detail ->> 'lead_magnet_id' = m.id::text),
    'unique_downloads', (select count(distinct e.lead_id) from public.lead_events e
                          where e.type = 'magnet_downloaded' and e.detail ->> 'lead_magnet_id' = m.id::text),
    'converted', (select count(distinct a.lead_id) from attributed a join public.leads l on l.id = a.lead_id
                   where a.magnet_id = m.id and l.status = 'converted'),
    'consults', (select count(distinct a.lead_id) from attributed a join public.leads l on l.id = a.lead_id
                  where a.magnet_id = m.id and (
                    l.status = 'consult_booked'
                    or exists (select 1 from public.lead_events e where e.lead_id = l.id and e.type = 'consult_booked')
                    or exists (select 1 from public.bookings b join public.session_types s on s.id = b.session_type_id
                                where b.lead_id = l.id and s.is_consultation
                                  and b.status in ('confirmed', 'completed', 'pending_payment'))))
  )), '[]'::jsonb)
  from magnets m
$$;
