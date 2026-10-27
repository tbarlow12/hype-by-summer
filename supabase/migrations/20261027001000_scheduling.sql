-- Scheduling: confirmation bookkeeping, client timezone and atomic reschedule.

-- When the confirmation side effects (emails, video room, notifications) ran.
-- onBookingConfirmed claims this column so webhook replays stay idempotent.
alter table public.bookings add column if not exists confirmation_sent_at timestamptz;
-- IANA timezone the client booked from (used to render emails for guests).
alter table public.bookings add column if not exists client_timezone text;

create index if not exists waitlist_entries_pending_lookup on public.waitlist_entries (session_type_id, starts_at)
  where notified_at is null;
create index if not exists bookings_rescheduled_from on public.bookings (rescheduled_from)
  where rescheduled_from is not null;

-- Move a confirmed booking to a new start time in one transaction. Reuses
-- reserve_booking (so all conflict / capacity / time-off checks apply, ignoring
-- the booking being moved), carries payment, credits and notes over to the new
-- booking and cancels the old one with cancel_reason = 'rescheduled' (no refund
-- side effects).
create or replace function public.reschedule_booking(
  p_booking uuid,
  p_starts_at timestamptz,
  p_actor uuid default null
) returns public.bookings
language plpgsql security definer set search_path = public, extensions as $$
declare
  old public.bookings;
  nb public.bookings;
  v_checkout text;
begin
  select * into old from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if old.status <> 'confirmed' then
    raise exception 'not_reschedulable' using errcode = 'P0001';
  end if;
  if old.starts_at = p_starts_at then
    raise exception 'same_time' using errcode = 'P0001';
  end if;

  nb := public.reserve_booking(
    old.session_type_id, p_starts_at, old.client_id, old.guest_name, old.guest_email, old.guest_phone,
    'confirmed', old.payment_method, 0, old.client_notes, old.lead_id, old.id
  );

  v_checkout := old.stripe_checkout_session_id;

  update public.bookings set
    status = 'cancelled',
    cancel_reason = 'rescheduled',
    cancelled_at = now(),
    cancelled_by = p_actor,
    stripe_checkout_session_id = null
  where id = old.id;

  update public.bookings set
    price_cents = old.price_cents,
    credits_used = old.credits_used,
    stripe_checkout_session_id = v_checkout,
    trainer_notes = old.trainer_notes,
    recurrence_group = old.recurrence_group,
    client_timezone = old.client_timezone,
    sms_opt_in = old.sms_opt_in
  where id = nb.id
  returning * into nb;

  update public.payments set booking_id = nb.id where booking_id = old.id;
  update public.credit_ledger set booking_id = nb.id where booking_id = old.id;

  return nb;
end $$;

revoke execute on function public.reschedule_booking from public, anon, authenticated;
