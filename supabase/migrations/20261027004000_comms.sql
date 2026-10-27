-- Communication: hardening + helpers for chat, form checks, notifications and broadcasts.

-- ---------------------------------------------------------------------------
-- Conversations: email throttling bookkeeping + safe "mark read"
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists trainer_emailed_at timestamptz,
  add column if not exists client_emailed_at timestamptz;

create index if not exists messages_conversation_created_desc
  on public.messages (conversation_id, created_at desc);

-- Members may only touch read markers (and only their own, via the RPC below).
revoke update on public.conversations from authenticated;
grant update (trainer_last_read_at, client_last_read_at) on public.conversations to authenticated;

create or replace function public.mark_conversation_read(p_conversation uuid) returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := now();
  c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or auth.uid() is null or auth.uid() not in (c.trainer_id, c.client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() = c.trainer_id then
    update public.conversations set trainer_last_read_at = v_now where id = p_conversation;
  else
    update public.conversations set client_last_read_at = v_now where id = p_conversation;
  end if;
  return v_now;
end $$;

-- Inbox rows for the signed-in user (trainer or client): the other party, the
-- latest message and the unread count. security invoker: RLS applies.
create or replace function public.conversation_inbox()
returns table (
  conversation_id uuid,
  trainer_id uuid,
  client_id uuid,
  other_id uuid,
  other_name text,
  other_email text,
  other_avatar_url text,
  last_message_at timestamptz,
  last_body text,
  last_kind public.message_kind,
  last_sender_id uuid,
  last_deleted boolean,
  unread_count int
)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.trainer_id, c.client_id, p.id, p.full_name, p.email::text, p.avatar_url,
         c.last_message_at, m.body, m.kind, m.sender_id, m.deleted_at is not null,
         (select count(*)::int from public.messages u
           where u.conversation_id = c.id
             and u.sender_id <> auth.uid()
             and u.deleted_at is null
             and u.created_at > coalesce(
               case when auth.uid() = c.trainer_id then c.trainer_last_read_at else c.client_last_read_at end,
               '-infinity'::timestamptz))
    from public.conversations c
    join public.profiles p on p.id = case when auth.uid() = c.trainer_id then c.client_id else c.trainer_id end
    left join lateral (
      select body, kind, sender_id, deleted_at from public.messages
       where conversation_id = c.id order by created_at desc limit 1
    ) m on true
   where auth.uid() in (c.trainer_id, c.client_id)
   order by c.last_message_at desc nulls last, c.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Messages: senders may only edit the body or soft-delete their own messages.
-- ---------------------------------------------------------------------------
revoke update on public.messages from authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;

create or replace function public.messages_guard_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then
    return new;                                   -- service role / server jobs
  end if;
  if old.kind = 'system' then
    raise exception 'system messages cannot be changed' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'message deleted' using errcode = '42501';
  end if;
  if new.deleted_at is not null then
    -- Soft delete: scrub content so the other party can no longer read it.
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

create or replace trigger messages_guard_update before update on public.messages
  for each row execute function public.messages_guard_update();

-- ---------------------------------------------------------------------------
-- Form-check videos: only the trainer reviews; nobody re-parents a submission.
-- ---------------------------------------------------------------------------
create or replace function public.video_submissions_guard_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.client_id <> old.client_id or new.trainer_id <> old.trainer_id
     or new.storage_path <> old.storage_path or new.created_at <> old.created_at then
    raise exception 'immutable fields' using errcode = '42501';
  end if;
  if auth.uid() <> old.trainer_id
     and (new.reviewed_at is distinct from old.reviewed_at
          or (new.status is distinct from old.status and new.status <> 'archived')) then
    raise exception 'only the trainer can review' using errcode = '42501';
  end if;
  if new.status = 'reviewed' and old.status <> 'reviewed' and new.reviewed_at is null then
    new.reviewed_at := now();
  end if;
  return new;
end $$;

create or replace trigger video_submissions_guard_update before update on public.video_submissions
  for each row execute function public.video_submissions_guard_update();

-- A submission's storage path must live in the client's own folder.
alter table public.video_submissions
  add constraint video_submissions_path_owner check (split_part(storage_path, '/', 1) = client_id::text);

-- ---------------------------------------------------------------------------
-- Notifications: users only flip read_at.
-- ---------------------------------------------------------------------------
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create index if not exists notifications_unread on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Broadcasts: delivery bookkeeping.
-- ---------------------------------------------------------------------------
alter table public.broadcasts
  add column if not exists emails_sent int not null default 0,
  add column if not exists emails_failed int not null default 0,
  add column if not exists sms_sent int not null default 0,
  add column if not exists sms_body text check (char_length(sms_body) <= 300);
create index if not exists broadcasts_trainer_created on public.broadcasts (trainer_id, created_at desc);

-- Realtime: read receipts need conversation updates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
