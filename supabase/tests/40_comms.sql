-- Communication: inbox, read markers, message edit/delete guards, form-check
-- review guards and notifications. Rolled back at the end.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'coach40@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'client40@example.com', '{"full_name":"Client B"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'other40@example.com', '{"full_name":"Client C"}');

-- Make sure the first account is the trainer even if seed data created one.
update public.profiles set role = 'trainer' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'client'
 where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1');

create temp table t40 (k text primary key, v uuid);
grant all on t40 to authenticated;

do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000000a1';
  cb uuid := '00000000-0000-0000-0000-0000000000b1';
  conv uuid; v uuid;
begin
  insert into public.trainer_clients (trainer_id, client_id) values (t, cb);
  conv := public.ensure_conversation(t, cb);
  insert into t40 values ('conv', conv);
  insert into public.messages (conversation_id, sender_id, body, created_at)
  values (conv, t, 'Welcome!', now() - interval '2 minutes'),
         (conv, t, 'How did today go?', now() - interval '1 minute');
  insert into public.video_submissions (client_id, trainer_id, title, storage_path)
  values (cb, t, 'Squat', cb::text || '/squat.mp4') returning id into v;
  insert into t40 values ('video', v);
  insert into public.notifications (user_id, type, title) values (cb, 'test', 'Hello');

  -- Storage path must live in the client's folder.
  begin
    insert into public.video_submissions (client_id, trainer_id, title, storage_path)
    values (cb, t, 'Bad', t::text || '/x.mp4');
    raise exception 'expected path check';
  exception when check_violation then null;
  end;
end $$;

-- Client B --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$
declare
  conv uuid := (select v from t40 where k = 'conv');
  vid uuid := (select v from t40 where k = 'video');
  r record; mid uuid;
begin
  select * into r from public.conversation_inbox();
  assert r.conversation_id = conv, 'client sees own conversation';
  assert r.unread_count = 2, 'two unread, got ' || r.unread_count;
  assert r.last_body = 'How did today go?', 'latest message preview';
  assert r.other_name = 'Coach', 'other party is the coach';

  perform public.mark_conversation_read(conv);
  assert (select unread_count from public.conversation_inbox()) = 0, 'read clears unread';
  assert (select client_last_read_at from public.conversations where id = conv) is not null, 'client marker set';
  assert (select trainer_last_read_at from public.conversations where id = conv) is null, 'trainer marker untouched';

  -- Direct writes to the other party's marker / ownership are blocked.
  begin
    update public.conversations set trainer_id = client_id where id = conv;
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;

  -- Send, edit, delete own message.
  insert into public.messages (conversation_id, sender_id, body)
  values (conv, auth.uid(), 'Great, thanks') returning id into mid;
  update public.messages set body = 'Great, thanks!' where id = mid;
  assert (select edited_at from public.messages where id = mid) is not null, 'edit stamps edited_at';
  update public.messages set deleted_at = now() where id = mid;
  assert (select body from public.messages where id = mid) = '', 'delete scrubs body';
  begin
    update public.messages set body = 'undo' where id = mid;
    raise exception 'expected deleted guard';
  exception when insufficient_privilege then null;
  end;

  -- Cannot edit the coach's messages (RLS hides them from update).
  update public.messages set body = 'hacked' where sender_id <> auth.uid();
  assert not exists (select 1 from public.messages where body = 'hacked'), 'cannot edit others';

  -- Cannot send system messages or change the sender/kind.
  begin
    insert into public.messages (conversation_id, sender_id, kind) values (conv, auth.uid(), 'system');
    raise exception 'expected rls error';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.messages set kind = 'system' where sender_id = auth.uid();
    raise exception 'expected column privilege error';
  exception when insufficient_privilege then null;
  end;

  -- Clients can comment on their own video but not mark it reviewed.
  insert into public.video_comments (submission_id, author_id, body, timestamp_seconds)
  values (vid, auth.uid(), 'Felt my knees cave at the bottom', 3.5);
  begin
    update public.video_submissions set status = 'reviewed' where id = vid;
    raise exception 'expected review guard';
  exception when insufficient_privilege then null;
  end;

  -- Notifications: own only, can flip read_at but not rewrite.
  assert (select count(*) from public.notifications) = 1, 'own notification visible';
  update public.notifications set read_at = now();
  assert (select count(*) from public.notifications where read_at is null) = 0, 'mark all read';
  begin
    update public.notifications set title = 'x';
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Client C (not in the conversation) ---------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
declare conv uuid := (select v from t40 where k = 'conv');
begin
  assert (select count(*) from public.conversation_inbox()) = 0, 'outsider has no inbox rows';
  assert (select count(*) from public.messages) = 0, 'outsider sees no messages';
  assert (select count(*) from public.video_submissions) = 0, 'outsider sees no videos';
  begin
    perform public.mark_conversation_read(conv);
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Trainer -------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  vid uuid := (select v from t40 where k = 'video');
  r record;
begin
  select * into r from public.conversation_inbox();
  assert r.other_name = 'Client B', 'trainer sees client in inbox';
  assert r.unread_count = 0, 'deleted client message not unread, got ' || r.unread_count;
  assert r.last_deleted, 'latest message is the deleted one';

  insert into public.video_comments (submission_id, author_id, body, timestamp_seconds)
  values (vid, auth.uid(), 'Push knees out', 3.4);
  assert (select count(*) from public.video_comments where submission_id = vid) = 2, 'both comments visible';
  update public.video_submissions set status = 'reviewed' where id = vid;
  assert (select reviewed_at from public.video_submissions where id = vid) is not null, 'reviewed_at stamped';
end $$;

rollback;
