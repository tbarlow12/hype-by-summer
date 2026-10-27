-- Scheduling: reschedule_booking carries payment/credits over, frees the old
-- slot, honours conflicts, and new columns exist. Rolled back at the end.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000010aa', 'coach-sched@example.com', '{"full_name":"Coach"}'),
  ('00000000-0000-0000-0000-0000000010bb', 'client-sched@example.com', '{"full_name":"Client"}'),
  ('00000000-0000-0000-0000-0000000010cc', 'client2-sched@example.com', '{"full_name":"Client 2"}');

do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000010aa';
  cb uuid := '00000000-0000-0000-0000-0000000010bb';
  cc uuid := '00000000-0000-0000-0000-0000000010cc';
  pt uuid; grp uuid; b public.bookings; nb public.bookings; other public.bookings; pay uuid;
begin
  -- The shared test DB may already have a trainer; force roles for this test.
  update public.profiles set role = 'trainer' where id = t;
  update public.profiles set role = 'client' where id in (cb, cc);

  insert into public.trainer_profiles (trainer_id, slug, business_name) values (t, 'coach-sched', 'Coach Sched');
  insert into public.trainer_clients (trainer_id, client_id) values (t, cb), (t, cc);
  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents, buffer_after_minutes)
  values (t, 'pt-60', '1:1 Training', 60, 9000, 15) returning id into pt;
  insert into public.session_types (trainer_id, slug, name, duration_minutes, price_cents, capacity)
  values (t, 'group', 'Group', 45, 2000, 2) returning id into grp;

  -- New columns default to null.
  b := public.reserve_booking(pt, '2031-03-03 15:00Z', cb, null, null, null, 'confirmed', 'credits', 0, 'knee', null);
  assert b.confirmation_sent_at is null and b.client_timezone is null, 'new columns default null';
  update public.bookings set client_timezone = 'America/New_York', trainer_notes = 'bring bands', credits_used = 1, sms_opt_in = true,
         stripe_checkout_session_id = 'cs_test_123'
   where id = b.id;

  insert into public.credit_ledger (client_id, trainer_id, delta, reason) values (cb, t, 3, 'purchase');
  perform public.consume_credits(cb, t, pt, 1, b.id);
  insert into public.payments (trainer_id, client_id, purpose, status, amount_cents, booking_id)
  values (t, cb, 'booking', 'succeeded', 9000, b.id) returning id into pay;

  -- Overlapping its own old slot is fine (the old booking is ignored).
  nb := public.reschedule_booking(b.id, '2031-03-03 15:30Z', cb);
  assert nb.id <> b.id, 'new booking row';
  assert nb.rescheduled_from = b.id, 'links to original';
  assert nb.status = 'confirmed' and nb.payment_method = 'credits', 'status + method carried';
  assert nb.ends_at = '2031-03-03 16:30Z', 'end recomputed';
  assert nb.credits_used = 1 and nb.trainer_notes = 'bring bands' and nb.client_notes = 'knee', 'details carried';
  assert nb.client_timezone = 'America/New_York' and nb.sms_opt_in, 'timezone + sms consent carried';
  assert nb.stripe_checkout_session_id = 'cs_test_123', 'checkout id moved';
  assert (select booking_id from public.payments where id = pay) = nb.id, 'payment moved';
  assert (select count(*) from public.credit_ledger where booking_id = nb.id and delta < 0) = 1, 'credit debit moved';
  assert (select count(*) from public.credit_ledger where booking_id = b.id) = 0, 'no debits left on old booking';
  assert public.credit_balance(cb, t, pt) = 2, 'credits not refunded by reschedule';

  select * into b from public.bookings where id = b.id;
  assert b.status = 'cancelled' and b.cancel_reason = 'rescheduled' and b.cancelled_by = cb, 'old booking cancelled';
  assert b.stripe_checkout_session_id is null, 'old checkout id cleared';

  -- The freed slot can be booked by someone else.
  other := public.reserve_booking(pt, '2031-03-03 17:00Z', cc, null, null, null, 'confirmed', 'free', 0, null);

  -- Rescheduling into another booking's window conflicts and changes nothing.
  begin
    perform public.reschedule_booking(nb.id, '2031-03-03 16:45Z', cb);
    raise exception 'expected conflict';
  exception when others then
    assert sqlerrm = 'slot_conflict', 'expected slot_conflict, got ' || sqlerrm;
  end;
  assert (select status from public.bookings where id = nb.id) = 'confirmed', 'still confirmed after failed reschedule';

  -- Only confirmed bookings can move; same time is rejected.
  begin
    perform public.reschedule_booking(b.id, '2031-03-04 15:00Z', cb);
    raise exception 'expected not_reschedulable';
  exception when others then assert sqlerrm = 'not_reschedulable', sqlerrm; end;
  begin
    perform public.reschedule_booking(nb.id, nb.starts_at, cb);
    raise exception 'expected same_time';
  exception when others then assert sqlerrm = 'same_time', sqlerrm; end;

  -- Time off blocks the target slot.
  insert into public.availability_overrides (trainer_id, starts_at, ends_at, is_available)
  values (t, '2031-03-05 00:00Z', '2031-03-06 00:00Z', false);
  begin
    perform public.reschedule_booking(nb.id, '2031-03-05 15:00Z', cb);
    raise exception 'expected slot_unavailable';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;

  -- Group: moving into a full class fails, moving into one with room works.
  perform public.reserve_booking(grp, '2031-03-10 15:00Z', cc, null, null, null, 'confirmed', 'free', 0, null);
  perform public.reserve_booking(grp, '2031-03-10 15:00Z', null, 'G', 'g@example.com', null, 'confirmed', 'free', 0, null);
  b := public.reserve_booking(grp, '2031-03-11 15:00Z', cb, null, null, null, 'confirmed', 'free', 0, null);
  begin
    perform public.reschedule_booking(b.id, '2031-03-10 15:00Z', cb);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
  nb := public.reschedule_booking(b.id, '2031-03-12 15:00Z', null);
  assert nb.session_type_id = grp and nb.status = 'confirmed', 'group reschedule ok';
end $$;

-- Clients cannot call the RPC directly.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010bb';
do $$ begin
  begin
    perform public.reschedule_booking(gen_random_uuid(), now());
    raise exception 'expected privilege error';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
