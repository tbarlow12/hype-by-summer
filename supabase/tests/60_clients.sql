-- Clients & team: note authorship, primary coach integrity, team management.
begin;

-- Business A: owner oa, admin ad, coaches ca + cb. Business B: owner ob.
-- c1 trains at A; c2 trains at B.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-000000000001', 'oa6@example.com', '{"full_name":"Owner A"}'),
  ('a6000000-0000-0000-0000-000000000002', 'ad6@example.com', '{"full_name":"Admin A"}'),
  ('a6000000-0000-0000-0000-000000000003', 'ca6@example.com', '{"full_name":"Coach A"}'),
  ('a6000000-0000-0000-0000-000000000004', 'cb6@example.com', '{"full_name":"Coach B"}'),
  ('a6000000-0000-0000-0000-000000000005', 'new6@example.com', '{"full_name":"New Hire"}'),
  ('b6000000-0000-0000-0000-000000000001', 'ob6@example.com', '{"full_name":"Owner B"}'),
  ('c6000000-0000-0000-0000-000000000001', 'c16@example.com', '{"full_name":"Client One"}'),
  ('c6000000-0000-0000-0000-000000000002', 'c26@example.com', '{"full_name":"Client Two"}');
insert into public.businesses (id, slug, name) values
  ('b6a00000-0000-0000-0000-000000000001', 'clients-a', 'Clients A'),
  ('b6b00000-0000-0000-0000-000000000001', 'clients-b', 'Clients B');
insert into public.business_members (business_id, user_id, role) values
  ('b6a00000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'owner'),
  ('b6a00000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'admin'),
  ('b6a00000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'coach'),
  ('b6a00000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000004', 'coach'),
  ('b6b00000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'owner');
insert into public.business_clients (business_id, client_id, primary_coach_id) values
  ('b6a00000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003'),
  ('b6b00000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', null);

-- Primary coach must be an active member of the same business.
do $$ begin
  begin
    update public.business_clients set primary_coach_id = 'b6000000-0000-0000-0000-000000000001'
     where business_id = 'b6a00000-0000-0000-0000-000000000001' and client_id = 'c6000000-0000-0000-0000-000000000001';
    raise exception 'expected primary_coach_not_member';
  exception when check_violation then assert sqlerrm = 'primary_coach_not_member', sqlerrm; end;
  begin
    insert into public.business_clients (business_id, client_id, primary_coach_id)
    values ('b6b00000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003');
    raise exception 'expected primary_coach_not_member on insert';
  exception when check_violation then null; end;
end $$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Coach A writes notes as themself and manages the roster.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-000000000003';
do $$
declare a uuid := 'b6a00000-0000-0000-0000-000000000001'; c1 uuid := 'c6000000-0000-0000-0000-000000000001';
begin
  insert into public.client_notes (business_id, client_id, body) values (a, c1, 'Coach A note');
  assert (select author_id from public.client_notes where body = 'Coach A note') = auth.uid(), 'author defaults to the writer';
  begin
    insert into public.client_notes (business_id, client_id, body, author_id)
    values (a, c1, 'forged', 'a6000000-0000-0000-0000-000000000004');
    raise exception 'expected rls violation (forged author)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.client_notes (business_id, client_id, body)
    values ('b6b00000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000002', 'other business');
    raise exception 'expected rls violation (other business)';
  exception when insufficient_privilege then null; end;
  begin
    update public.client_notes set author_id = 'a6000000-0000-0000-0000-000000000004' where body = 'Coach A note';
    raise exception 'expected privilege error (author is fixed)';
  exception when insufficient_privilege then null; end;
  update public.client_notes set pinned = true where body = 'Coach A note';
  assert (select pinned from public.client_notes where body = 'Coach A note'), 'author pins own note';

  -- Reassign the client to Coach B; a non-member is refused.
  update public.business_clients set primary_coach_id = 'a6000000-0000-0000-0000-000000000004', tags = '{vip}'
   where business_id = a and client_id = c1;
  assert (select primary_coach_id from public.business_clients where client_id = c1 and business_id = a)
         = 'a6000000-0000-0000-0000-000000000004', 'coach reassigns primary coach';
  -- Coaches cannot manage the team.
  begin
    insert into public.business_members (business_id, user_id, role) values (a, 'a6000000-0000-0000-0000-000000000005', 'coach');
    raise exception 'expected rls violation (coach invites)';
  exception when insufficient_privilege then null; end;
end $$;

-- Coach B can read but not change or delete Coach A's note.
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-000000000004';
do $$ begin
  assert (select count(*) from public.client_notes) = 1, 'team reads notes';
  update public.client_notes set body = 'edited by B';
  delete from public.client_notes;
  assert (select body from public.client_notes) = 'Coach A note', 'other coach cannot edit or delete';
end $$;

-- ---------------------------------------------------------------------------
-- Admin A runs the team but cannot appoint owners; can moderate notes.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-000000000002';
do $$
declare a uuid := 'b6a00000-0000-0000-0000-000000000001';
begin
  insert into public.business_members (business_id, user_id, role, invited_by)
  values (a, 'a6000000-0000-0000-0000-000000000005', 'staff', auth.uid());
  update public.business_members set role = 'coach', is_bookable = false
   where business_id = a and user_id = 'a6000000-0000-0000-0000-000000000005';
  assert (select role from public.business_members where user_id = 'a6000000-0000-0000-0000-000000000005') = 'coach', 'admin changes roles';
  update public.business_members set active = false
   where business_id = a and user_id = 'a6000000-0000-0000-0000-000000000004';
  assert not (select active from public.business_members where user_id = 'a6000000-0000-0000-0000-000000000004'), 'admin deactivates';
  begin
    update public.business_members set role = 'owner'
     where business_id = a and user_id = 'a6000000-0000-0000-0000-000000000005';
    raise exception 'expected owner guard';
  exception when insufficient_privilege then null; end;
  begin
    update public.business_members set role = 'coach'
     where business_id = a and user_id = 'a6000000-0000-0000-0000-000000000001';
    raise exception 'expected last-owner guard';
  exception when check_violation then null; end;
  update public.client_notes set body = 'moderated' where business_id = a;
  assert (select body from public.client_notes) = 'moderated', 'manager edits any note';
  delete from public.client_notes where business_id = a;
  assert (select count(*) from public.client_notes) = 0, 'manager deletes any note';
end $$;

-- Deactivated Coach B sees nothing anymore.
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-000000000004';
do $$ begin
  assert (select count(*) from public.business_clients) = 0, 'inactive member loses access';
end $$;

-- The owner appoints a co-owner.
set local request.jwt.claim.sub = 'a6000000-0000-0000-0000-000000000001';
do $$ begin
  update public.business_members set role = 'owner'
   where business_id = 'b6a00000-0000-0000-0000-000000000001' and user_id = 'a6000000-0000-0000-0000-000000000002';
  assert (select count(*) from public.business_members where role = 'owner'
           and business_id = 'b6a00000-0000-0000-0000-000000000001') = 2, 'owner appoints owner';
end $$;

-- Clients never see notes and can't edit their relationship.
set local request.jwt.claim.sub = 'c6000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.client_notes) = 0, 'clients see no notes';
  update public.business_clients set tags = '{hacked}';
  assert (select tags from public.business_clients) = '{vip}', 'client cannot edit relationship';
end $$;

rollback;
