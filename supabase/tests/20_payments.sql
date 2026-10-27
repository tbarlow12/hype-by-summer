-- Payments: credit reporting/adjustment RPCs, idempotent grants, RLS.
-- Everything runs in a transaction that is rolled back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'pay-coach@example.com', '{"full_name":"Pay Coach"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'pay-client@example.com', '{"full_name":"Pay Client"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'pay-other@example.com', '{"full_name":"Other Client"}');

do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000000a1';
  cb uuid := '00000000-0000-0000-0000-0000000000b1';
  cc uuid := '00000000-0000-0000-0000-0000000000c1';
  st uuid;
  o uuid;
  p uuid;
  g1 uuid;
  n int;
begin
  -- Earlier test files may already have created the trainer; make sure roles are right here.
  update public.profiles set role = 'trainer' where id = t;
  update public.profiles set role = 'client' where id in (cb, cc);
  insert into public.trainer_profiles (trainer_id, slug, business_name) values (t, 'pay-coach', 'Pay Co');
  insert into public.trainer_clients (trainer_id, client_id) values (t, cb);
  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents)
  values (t, 'pt', 'PT', 60, 9000) returning id into st;

  insert into public.offerings (trainer_id, kind, name, price_cents, credits, credits_expire_days, session_type_ids)
  values (t, 'package', '10 pack', 80000, 10, 90, array[st]) returning id into o;
  insert into public.payments (trainer_id, client_id, purpose, status, amount_cents, offering_id, stripe_checkout_session_id, paid_at)
  values (t, cb, 'package', 'succeeded', 80000, o, 'cs_test_1', now()) returning id into p;

  -- Grant once per payment (webhook replay protection).
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, offering_id, payment_id, session_type_ids, expires_at)
  values (cb, t, 10, 'purchase', o, p, array[st], now() + interval '90 days') returning id into g1;
  begin
    insert into public.credit_ledger (client_id, trainer_id, delta, reason, payment_id)
    values (cb, t, 10, 'purchase', p);
    raise exception 'expected unique violation';
  exception when unique_violation then null;
  end;

  -- An unrestricted manual grant, plus an expired one that never counts.
  insert into public.credit_ledger (client_id, trainer_id, delta, reason) values (cb, t, 3, 'adjustment');
  insert into public.credit_ledger (client_id, trainer_id, delta, reason, expires_at)
  values (cb, t, 50, 'adjustment', now() - interval '1 day');

  perform public.consume_credits(cb, t, st, 2, null);
  assert (select remaining from public.credit_grants_remaining(cb, t) where grant_id = g1) = 8,
    'package grant has 8 left after using 2';
  assert (select count(*) from public.credit_grants_remaining(cb, t)) = 2, 'expired grant hidden';
  assert public.outstanding_credits(t) = 11, 'outstanding = 8 + 3, got ' || public.outstanding_credits(t);

  -- Negative adjustment: FIFO by expiry (package expires first, manual grant has none).
  n := public.debit_credits(cb, t, 9, 'adjustment', 'goodwill reversal', t);
  assert n = 9, 'debited 9';
  assert (select remaining from public.credit_grants_remaining(cb, t) where grant_id = g1) = 0, 'package drained first';
  assert public.credit_balance(cb, t) = 2, 'balance now 2';

  -- Never removes more than is available.
  n := public.debit_credits(cb, t, 100, 'adjustment');
  assert n = 2, 'only 2 left to debit, got ' || n;
  assert public.credit_balance(cb, t) = 0, 'balance now 0';

  -- Refund claw-back only touches the refunded payment's grants.
  insert into public.credit_ledger (client_id, trainer_id, delta, reason) values (cb, t, 4, 'adjustment');
  n := public.debit_credits(cb, t, 10, 'refund', null, null, p);
  assert n = 0, 'payment grant already used up';
  assert public.credit_balance(cb, t) = 4, 'other grants untouched';

  begin
    perform public.debit_credits(cb, t, 0, 'adjustment');
    raise exception 'expected invalid_amount';
  exception when others then assert sqlerrm = 'invalid_amount', sqlerrm; end;

  -- Digital products bucket exists and is private.
  assert (select public from storage.buckets where id = 'digital-products') = false, 'digital-products is private';
end $$;

-- RLS / authorization as the client.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  assert (select count(*) from public.payments) = 1, 'client sees own payment';
  assert (select count(*) from public.credit_grants_remaining('00000000-0000-0000-0000-0000000000b1')) >= 1, 'client reads own grants';
  begin
    perform public.outstanding_credits('00000000-0000-0000-0000-0000000000a1');
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.debit_credits('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 1, 'x');
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments (trainer_id, client_id, purpose, amount_cents)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'package', 1);
    raise exception 'expected RLS violation';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Another client can't read someone else's credits.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$ begin
  assert (select count(*) from public.payments) = 0, 'other client sees no payments';
  begin
    perform * from public.credit_grants_remaining('00000000-0000-0000-0000-0000000000b1');
    raise exception 'expected forbidden';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Trainer sees payments, outstanding credits and the client's grants.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert (select count(*) from public.payments) = 1, 'trainer sees payment';
  assert public.outstanding_credits('00000000-0000-0000-0000-0000000000a1') = 4, 'trainer outstanding';
  assert (select count(*) from public.credit_grants_remaining('00000000-0000-0000-0000-0000000000b1')) >= 1, 'trainer reads client grants';
end $$;

rollback;
