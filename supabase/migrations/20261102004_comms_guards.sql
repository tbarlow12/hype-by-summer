-- Communication guards for shared team threads and form checks.
-- Only for signed-in callers (auth.uid() not null); the service role is trusted.

-- A thread exists only between a business and one of its clients: the client
-- (while an active client) or the business's staff may open it.
create or replace function public.ensure_conversation(p_business uuid, p_client uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null then
    if auth.uid() = p_client then
      if not public.is_client_of(p_business) then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    elsif not public.is_member(p_business)
       or not exists (select 1 from public.business_clients where business_id = p_business and client_id = p_client) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  insert into public.conversations (business_id, client_id) values (p_business, p_client)
  on conflict (business_id, client_id) do nothing;
  select id into v_id from public.conversations where business_id = p_business and client_id = p_client;
  return v_id;
end $$;

-- New messages may only reference things that belong to the thread:
-- attachments in the sender's own folder (staff: also the business folder),
-- the client's own workout logs and form checks in this business.
create or replace function public.messages_guard_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.conversations;
  v_owner text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select * into c from public.conversations where id = new.conversation_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  new.edited_at := null;
  new.deleted_at := null;
  if new.attachment_path is not null then
    v_owner := split_part(new.attachment_path, '/', 1);
    if new.attachment_path like '%..%'
       or not (v_owner = auth.uid()::text or (v_owner = c.business_id::text and public.is_member(c.business_id))) then
      raise exception 'attachment outside your folder' using errcode = '42501';
    end if;
  end if;
  if new.workout_log_id is not null and not exists (
       select 1 from public.workout_logs l
        where l.id = new.workout_log_id and l.client_id = c.client_id and l.business_id = c.business_id) then
    raise exception 'workout not in this thread' using errcode = '42501';
  end if;
  if new.video_submission_id is not null and not exists (
       select 1 from public.video_submissions v
        where v.id = new.video_submission_id and v.client_id = c.client_id and v.business_id = c.business_id) then
    raise exception 'form check not in this thread' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger messages_guard_insert before insert on public.messages
  for each row execute function public.messages_guard_insert();

-- Form checks: the reviewer must be on the business's team; clients can't
-- submit something pre-reviewed; reopening clears the review stamp.
create or replace function public.video_submissions_guard_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.coach_id is not null and not exists (
       select 1 from public.business_members
        where business_id = new.business_id and user_id = new.coach_id and active) then
    raise exception 'reviewer must be on the team' using errcode = '42501';
  end if;
  if not public.is_member(new.business_id) then
    new.status := 'pending_review';
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end $$;
create trigger video_submissions_guard_insert before insert on public.video_submissions
  for each row execute function public.video_submissions_guard_insert();

create or replace function public.video_submissions_guard_update() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
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
          or new.reviewed_by is distinct from old.reviewed_by
          or new.coach_id is distinct from old.coach_id
          or (new.status is distinct from old.status and new.status <> 'archived')) then
    raise exception 'only staff can review' using errcode = '42501';
  end if;
  if new.coach_id is distinct from old.coach_id and new.coach_id is not null and not exists (
       select 1 from public.business_members
        where business_id = new.business_id and user_id = new.coach_id and active) then
    raise exception 'reviewer must be on the team' using errcode = '42501';
  end if;
  if new.status = 'reviewed' and old.status <> 'reviewed' then
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := auth.uid();
  elsif new.status = 'pending_review' and old.status = 'reviewed' then
    new.reviewed_at := null;
    new.reviewed_by := null;
  elsif new.status = 'reviewed' then
    new.reviewed_by := old.reviewed_by;
  end if;
  return new;
end $$;
