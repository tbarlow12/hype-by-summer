-- Communication: chat (one thread per client per business, shared by the
-- business's staff), form-check videos, notifications, broadcasts,
-- testimonials and SMS.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz,
  staff_last_read_at timestamptz,
  client_last_read_at timestamptz,
  staff_emailed_at timestamptz,
  client_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, client_id)
);
create index on public.conversations (business_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,   -- null = system
  kind public.message_kind not null default 'text',
  body text,
  attachment_path text,
  attachment_mime text,
  video_submission_id uuid,
  workout_log_id uuid references public.workout_logs (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null or kind = 'system'),
  check (sender_id is not null or kind = 'system')
);
create index on public.messages (conversation_id, created_at desc);

create table public.video_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete set null,      -- assigned reviewer
  exercise_id uuid references public.exercises (id) on delete set null,
  title text not null,
  client_note text,
  storage_path text not null check (split_part(storage_path, '/', 1) = client_id::text),
  mime_type text,
  duration_seconds numeric,
  status text not null default 'pending_review' check (status in ('pending_review', 'reviewed', 'archived')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.video_submissions (business_id, status, created_at desc);
create index on public.video_submissions (client_id, created_at desc);

alter table public.messages add constraint messages_video_submission_fkey
  foreign key (video_submission_id) references public.video_submissions (id) on delete set null;

create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.video_submissions (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  timestamp_seconds numeric,
  body text not null,
  created_at timestamptz not null default now()
);
create index on public.video_comments (submission_id, timestamp_seconds);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,  -- null = platform notice
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, business_id, created_at desc);
create index on public.notifications (user_id) where read_at is null;

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  audience text not null default 'active_clients'
    check (audience in ('active_clients', 'all_clients', 'leads', 'subscribers')),
  subject text not null,
  body text not null,
  sms_body text check (char_length(sms_body) <= 300),
  channels public.notification_channel[] not null default '{in_app,email}',
  recipient_count int not null default 0,
  emails_sent int not null default 0,
  emails_failed int not null default 0,
  sms_sent int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.broadcasts (business_id, created_at desc);

create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete set null,
  client_id uuid references public.profiles (id) on delete set null,
  author_name text not null,
  rating smallint check (rating between 1 and 5),
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.testimonials (business_id, approved);

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete set null,
  to_phone text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  kind text not null,
  body text not null,
  twilio_sid text unique,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sms_messages (business_id, created_at desc);
create trigger sms_messages_updated before update on public.sms_messages
  for each row execute function public.set_updated_at();

-- Numbers that replied STOP (platform-wide, carriers require it).
create table public.sms_opt_outs (
  phone text primary key,
  opted_out_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Functions and guards
-- ---------------------------------------------------------------------------
create or replace function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation
       and (c.client_id = auth.uid() or public.is_member(c.business_id)))
$$;

create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- Ensure the client's thread with a business exists (caller: that client or staff).
create or replace function public.ensure_conversation(p_business uuid, p_client uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_client and not public.is_member(p_business) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.conversations (business_id, client_id) values (p_business, p_client)
  on conflict (business_id, client_id) do nothing;
  select id into v_id from public.conversations where business_id = p_business and client_id = p_client;
  return v_id;
end $$;

-- Mark the caller's side of a thread read (staff share one marker).
create or replace function public.mark_conversation_read(p_conversation uuid) returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := now();
  c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() = c.client_id then
    update public.conversations set client_last_read_at = v_now where id = p_conversation;
  elsif public.is_member(c.business_id) then
    update public.conversations set staff_last_read_at = v_now where id = p_conversation;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_now;
end $$;

-- Staff inbox for one business: each client thread with last message and
-- unread count. security invoker: RLS applies.
create or replace function public.conversation_inbox(p_business uuid)
returns table (
  conversation_id uuid, client_id uuid, client_name text, client_email text, client_avatar_url text,
  last_message_at timestamptz, last_body text, last_kind public.message_kind, last_sender_id uuid,
  last_deleted boolean, unread_count int
)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.client_id, p.full_name, p.email::text, p.avatar_url,
         c.last_message_at, m.body, m.kind, m.sender_id, m.deleted_at is not null,
         (select count(*)::int from public.messages u
           where u.conversation_id = c.id and u.sender_id = c.client_id and u.deleted_at is null
             and u.created_at > coalesce(c.staff_last_read_at, '-infinity'::timestamptz))
    from public.conversations c
    join public.profiles p on p.id = c.client_id
    left join lateral (
      select body, kind, sender_id, deleted_at from public.messages
       where conversation_id = c.id order by created_at desc limit 1
    ) m on true
   where c.business_id = p_business
   order by c.last_message_at desc nulls last, c.created_at desc
$$;

-- Senders may only edit the body or soft-delete their own messages.
create or replace function public.messages_guard_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.kind = 'system' then
    raise exception 'system messages cannot be changed' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'message deleted' using errcode = '42501';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := '';
    new.attachment_path := null;
    new.attachment_mime := null;
    new.workout_log_id := null;
    new.video_submission_id := null;
  elsif new.body is distinct from old.body then
    if old.kind not in ('text', 'image', 'video', 'file') then
      raise exception 'only text messages can be edited' using errcode = '42501';
    end if;
    if coalesce(btrim(new.body), '') = '' and old.attachment_path is null then
      raise exception 'message body required' using errcode = '23514';
    end if;
    new.edited_at := now();
  end if;
  return new;
end $$;
create trigger messages_guard_update before update on public.messages
  for each row execute function public.messages_guard_update();

-- Only the business's staff review a form check; nobody re-parents one.
create or replace function public.video_submissions_guard_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.client_id <> old.client_id or new.business_id <> old.business_id
     or new.storage_path <> old.storage_path or new.created_at <> old.created_at then
    raise exception 'immutable fields' using errcode = '42501';
  end if;
  if not public.is_member(old.business_id)
     and (new.reviewed_at is distinct from old.reviewed_at
          or new.coach_id is distinct from old.coach_id
          or (new.status is distinct from old.status and new.status <> 'archived')) then
    raise exception 'only staff can review' using errcode = '42501';
  end if;
  if new.status = 'reviewed' and old.status <> 'reviewed' then
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := auth.uid();
  end if;
  return new;
end $$;
create trigger video_submissions_guard_update before update on public.video_submissions
  for each row execute function public.video_submissions_guard_update();
