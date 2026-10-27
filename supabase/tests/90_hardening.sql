begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'coach90@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'client90@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'snoop90@example.com');
update public.profiles set role = 'trainer' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'client' where id <> '00000000-0000-0000-0000-0000000000a1'
  and id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1');
insert into public.trainer_clients (trainer_id, client_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
insert into public.credit_ledger (client_id, trainer_id, delta, reason) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 3, 'purchase');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  assert public.credit_balance('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1') = 3, 'client sees own balance';
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert public.credit_balance('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1') = 3, 'trainer sees client balance';
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  perform public.credit_balance('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1');
  raise exception 'expected forbidden';
exception when insufficient_privilege then null;
end $$;
rollback;
