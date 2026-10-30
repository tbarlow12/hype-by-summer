-- Communication: shared team threads, message guards, form-check review.
begin;

-- Business A: owner oa, coaches ca + cb. Business B: owner ob.
-- c1 trains at A (primary coach ca); c2 trains at B; s is nobody's client.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-000000000001', 'oa@example.com', '{"full_name":"Owner A"}'),
  ('a4000000-0000-0000-0000-000000000002', 'ca@example.com', '{"full_name":"Coach A"}'),
  ('a4000000-0000-0000-0000-000000000003', 'cb@example.com', '{"full_name":"Coach B"}'),
  ('b4000000-0000-0000-0000-000000000001', 'ob@example.com', '{"full_name":"Owner B"}'),
  ('c4000000-0000-0000-0000-000000000001', 'c1@example.com', '{"full_name":"Client One"}'),
  ('c4000000-0000-0000-0000-000000000002', 'c2@example.com', '{"full_name":"Client Two"}'),
  ('c4000000-0000-0000-0000-000000000003', 's@example.com', '{"full_name":"Stranger"}');
insert into public.businesses (id, slug, name) values
  ('b4a00000-0000-0000-0000-000000000001', 'comms-a', 'Comms A'),
  ('b4b00000-0000-0000-0000-000000000001', 'comms-b', 'Comms B');
insert into public.business_members (business_id, user_id, role) values
  ('b4a00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'owner'),
  ('b4a00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 'coach'),
  ('b4a00000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003', 'coach'),
  ('b4b00000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'owner');
insert into public.business_clients (business_id, client_id, primary_coach_id) values
  ('b4a00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002'),
  ('b4b00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000001');
insert into public.workout_logs (id, business_id, client_id) values
  ('d4000000-0000-0000-0000-000000000001', 'b4a00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001'),
  ('d4000000-0000-0000-0000-000000000002', 'b4b00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002');

set local role authenticated;

-- Client One opens their thread and writes in it.
set local request.jwt.claim.sub = 'c4000000-0000-0000-0000-000000000001';
do $$
declare
  a uuid := 'b4a00000-0000-0000-0000-000000000001';
  b uuid := 'b4b00000-0000-0000-0000-000000000001';
  me uuid := 'c4000000-0000-0000-0000-000000000001';
  conv uuid;
begin
  conv := public.ensure_conversation(a, me);
  assert conv is not null, 'client opens own thread';
  perform set_config('test.conv', conv::text, true);
  begin
    perform public.ensure_conversation(b, me);
    raise exception 'expected forbidden (not a client of B)';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ensure_conversation(a, 'c4000000-0000-0000-0000-000000000002');
    raise exception 'expected forbidden (someone else''s thread)';
  exception when insufficient_privilege then null; end;

  insert into public.messages (conversation_id, sender_id, body) values (conv, me, 'Hi team');
  insert into public.messages (conversation_id, sender_id, kind, attachment_path, attachment_mime)
    values (conv, me, 'image', me || '/photo.jpg', 'image/jpeg');
  insert into public.messages (conversation_id, sender_id, kind, body, workout_log_id)
    values (conv, me, 'workout_share', 'Leg day', 'd4000000-0000-0000-0000-000000000001');
  begin
    insert into public.messages (conversation_id, sender_id, kind, body) values (conv, me, 'system', 'fake');
    raise exception 'expected rls violation (system)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, kind, attachment_path)
      values (conv, me, 'file', a || '/staff-only.pdf');
    raise exception 'expected attachment guard (client using business folder)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, kind, attachment_path)
      values (conv, me, 'file', 'c4000000-0000-0000-0000-000000000002/x.pdf');
    raise exception 'expected attachment guard (other user''s folder)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.messages (conversation_id, sender_id, kind, body, workout_log_id)
      values (conv, me, 'workout_share', 'Not mine', 'd4000000-0000-0000-0000-000000000002');
    raise exception 'expected workout guard';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.messages where conversation_id = conv) = 3, 'three client messages';
end $$;

-- Coach A (primary coach) sees the thread, unread count, replies.
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-000000000002';
do $$
declare
  a uuid := 'b4a00000-0000-0000-0000-000000000001';
  me uuid := 'a4000000-0000-0000-0000-000000000002';
  conv uuid := current_setting('test.conv')::uuid;
begin
  assert (select unread_count from public.conversation_inbox(a) where conversation_id = conv) = 3, 'staff unread 3';
  assert public.ensure_conversation(a, 'c4000000-0000-0000-0000-000000000001') = conv, 'staff gets same thread';
  begin
    perform public.ensure_conversation(a, 'c4000000-0000-0000-0000-000000000003');
    raise exception 'expected forbidden (not a client)';
  exception when insufficient_privilege then null; end;
  insert into public.messages (id, conversation_id, sender_id, body)
    values ('e4000000-0000-0000-0000-000000000001', conv, me, 'Hey! Coach A here');
  insert into public.messages (conversation_id, sender_id, kind, attachment_path, attachment_mime)
    values (conv, me, 'file', a || '/plan.pdf', 'application/pdf');
  begin
    insert into public.messages (conversation_id, sender_id, kind, attachment_path)
      values (conv, me, 'file', 'b4b00000-0000-0000-0000-000000000001/x.pdf');
    raise exception 'expected attachment guard (other business folder)';
  exception when insufficient_privilege then null; end;
  perform public.mark_conversation_read(conv);
  assert (select staff_last_read_at from public.conversations where id = conv) is not null, 'staff marker set';
  assert (select client_last_read_at from public.conversations where id = conv) is null, 'client marker untouched';
end $$;

-- Coach B shares the thread: same messages, shared read marker, can't touch Coach A's message.
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-000000000003';
do $$
declare
  a uuid := 'b4a00000-0000-0000-0000-000000000001';
  conv uuid := current_setting('test.conv')::uuid;
  n int;
begin
  assert (select count(*) from public.messages where conversation_id = conv) = 5, 'team sees whole thread';
  assert (select unread_count from public.conversation_inbox(a) where conversation_id = conv) = 0, 'read marker is shared';
  update public.messages set body = 'hijacked' where id = 'e4000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'cannot edit a teammate''s message';
  update public.messages set deleted_at = now() where id = 'e4000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'cannot delete a teammate''s message';
  insert into public.messages (conversation_id, sender_id, body) values (conv, 'a4000000-0000-0000-0000-000000000003', 'Coach B too');
  begin
    insert into public.messages (conversation_id, sender_id, body) values (conv, 'a4000000-0000-0000-0000-000000000002', 'impersonation');
    raise exception 'expected rls violation (sender must be me)';
  exception when insufficient_privilege then null; end;
end $$;

-- Coach A edits and deletes their own message.
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-000000000002';
do $$
declare
  m public.messages;
begin
  update public.messages set body = 'Hey! Coach A here (edited)' where id = 'e4000000-0000-0000-0000-000000000001' returning * into m;
  assert m.edited_at is not null, 'edit stamped';
  update public.messages set deleted_at = now() where id = 'e4000000-0000-0000-0000-000000000001' returning * into m;
  assert m.body = '' and m.deleted_at is not null, 'soft delete clears body';
  begin
    update public.messages set body = 'undelete' where id = 'e4000000-0000-0000-0000-000000000001';
    raise exception 'expected message deleted';
  exception when insufficient_privilege then null; end;
end $$;

-- Another business sees nothing and can't write in.
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000001';
do $$
declare
  conv uuid := current_setting('test.conv')::uuid;
begin
  assert (select count(*) from public.messages where conversation_id = conv) = 0, 'other business reads nothing';
  assert (select count(*) from public.conversations) = 0, 'no threads visible';
  assert (select count(*) from public.conversation_inbox('b4a00000-0000-0000-0000-000000000001')) = 0, 'no inbox';
  begin
    insert into public.messages (conversation_id, sender_id, body) values (conv, 'b4000000-0000-0000-0000-000000000001', 'hi');
    raise exception 'expected rls violation';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ensure_conversation('b4a00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001');
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mark_conversation_read(conv);
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null; end;
end $$;

-- Form checks: client submits, reviewer must be on the team, can't self-review.
set local request.jwt.claim.sub = 'c4000000-0000-0000-0000-000000000001';
do $$
declare
  a uuid := 'b4a00000-0000-0000-0000-000000000001';
  me uuid := 'c4000000-0000-0000-0000-000000000001';
  v public.video_submissions;
begin
  begin
    insert into public.video_submissions (business_id, client_id, coach_id, title, storage_path)
      values (a, me, 'b4000000-0000-0000-0000-000000000001', 'Squat', me || '/squat.mp4');
    raise exception 'expected reviewer guard';
  exception when insufficient_privilege then null; end;
  insert into public.video_submissions (id, business_id, client_id, coach_id, title, storage_path, status, reviewed_at)
    values ('f4000000-0000-0000-0000-000000000001', a, me, 'a4000000-0000-0000-0000-000000000002', 'Squat', me || '/squat.mp4', 'reviewed', now())
    returning * into v;
  assert v.status = 'pending_review' and v.reviewed_at is null, 'clients cannot pre-review';
  begin
    update public.video_submissions set coach_id = 'a4000000-0000-0000-0000-000000000003' where id = v.id;
    raise exception 'expected only staff';
  exception when insufficient_privilege then null; end;
  begin
    update public.video_submissions set status = 'reviewed' where id = v.id;
    raise exception 'expected only staff';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.video_submissions (business_id, client_id, title, storage_path)
      values ('b4b00000-0000-0000-0000-000000000001', me, 'Elsewhere', me || '/x.mp4');
    raise exception 'expected rls violation (not a client of B)';
  exception when insufficient_privilege then null; end;
  -- A form check message must belong to this thread.
  insert into public.messages (conversation_id, sender_id, kind, body, video_submission_id)
    values (current_setting('test.conv')::uuid, me, 'text', 'Sent a form check', v.id);
end $$;

-- Coach B (not the assigned reviewer) can reassign and review; reviewed_by is recorded.
set local request.jwt.claim.sub = 'a4000000-0000-0000-0000-000000000003';
do $$
declare
  v public.video_submissions;
begin
  begin
    update public.video_submissions set coach_id = 'b4000000-0000-0000-0000-000000000001'
     where id = 'f4000000-0000-0000-0000-000000000001';
    raise exception 'expected reviewer guard';
  exception when insufficient_privilege then null; end;
  update public.video_submissions set coach_id = 'a4000000-0000-0000-0000-000000000003'
   where id = 'f4000000-0000-0000-0000-000000000001';
  update public.video_submissions set status = 'reviewed', reviewed_by = 'a4000000-0000-0000-0000-000000000001'
   where id = 'f4000000-0000-0000-0000-000000000001' returning * into v;
  assert v.reviewed_by = 'a4000000-0000-0000-0000-000000000003' and v.reviewed_at is not null, 'reviewer recorded as caller';
  update public.video_submissions set status = 'pending_review'
   where id = 'f4000000-0000-0000-0000-000000000001' returning * into v;
  assert v.reviewed_by is null and v.reviewed_at is null, 'reopen clears review';
end $$;

-- Other business can't see the form check.
set local request.jwt.claim.sub = 'b4000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.video_submissions) = 0, 'form checks isolated';
end $$;

rollback;
