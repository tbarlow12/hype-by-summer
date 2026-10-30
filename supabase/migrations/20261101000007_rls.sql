-- Row level security. This is white-label software, not a marketplace:
-- businesses are invisible to each other and to the public API. Anonymous
-- visitors get no direct table access; each business's public site is
-- rendered by the server, which reads only the business its host maps to.
-- Businesses are isolated from each other; within a
-- business, staff (any active member) work with its data, owners/admins manage
-- settings, prices and the team, and clients see only their own rows.
-- Money, credits, leads from public forms and booking creation are written by
-- the server with the service role.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'businesses', 'business_members', 'business_clients', 'client_notes', 'client_intakes',
    'session_types', 'availability_rules', 'availability_overrides', 'bookings', 'waitlist_entries',
    'offerings', 'subscriptions', 'payments', 'credit_ledger', 'stripe_events', 'platform_fees',
    'lead_magnets', 'leads', 'lead_events',
    'exercises', 'programs', 'program_workouts', 'workout_exercises', 'workout_logs', 'set_logs',
    'program_feedback', 'check_ins', 'body_metrics', 'progress_photos', 'goals', 'habits', 'habit_logs',
    'conversations', 'messages', 'video_submissions', 'video_comments', 'notifications', 'broadcasts',
    'testimonials', 'sms_messages', 'sms_opt_outs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles ------------------------------------------------------------------
create policy "profiles: self" on public.profiles for select using (id = auth.uid());
create policy "profiles: shared business" on public.profiles for select using (public.shares_business_with(id));
create policy "profiles: platform admin" on public.profiles for select using (public.is_platform_admin());
create policy "profiles: self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, phone, timezone, date_of_birth, marketing_opt_in, sms_opt_in, onboarded_at)
  on public.profiles to authenticated;

-- businesses: public storefront fields; owners/admins edit brand + policies ---
create policy "businesses: members and clients" on public.businesses for select
  using (public.is_member(id) or public.is_client_of(id));
create policy "businesses: managers update" on public.businesses for update
  using (public.can_manage(id)) with check (public.can_manage(id));
revoke select, insert, update, delete on public.businesses from anon, authenticated;
grant select (id, slug, custom_domain, domain_verified_at, name, headline, bio, specialties, certifications,
  instagram_handle, website_url, brand_color, logo_url, cover_image_url, font_preset, default_location,
  support_email, timezone, cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents,
  refund_on_cancel, reminder_hours, accepting_new_clients, status, created_at, updated_at)
  on public.businesses to authenticated;
grant update (slug, name, headline, bio, specialties, certifications, instagram_handle, website_url,
  brand_color, logo_url, cover_image_url, font_preset, default_location, support_email, timezone,
  cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents, refund_on_cancel, reminder_hours,
  accepting_new_clients)
  on public.businesses to authenticated;

-- business_members: public coach profiles; managers run the team -------------
create policy "members: same business" on public.business_members for select
  using (public.is_member(business_id) or public.is_client_of(business_id));
create policy "members: managers write" on public.business_members for all
  using (public.can_manage(business_id)) with check (public.can_manage(business_id));
create policy "members: self update" on public.business_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke select on public.business_members from anon, authenticated;
grant select (business_id, user_id, role, slug, title, bio, specialties, is_bookable, active, created_at, updated_at)
  on public.business_members to authenticated;

-- Roles and activation change only through owners/admins; a business always
-- keeps at least one active owner.
create or replace function public.business_members_guard() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE'
     and (new.role is distinct from old.role or new.active is distinct from old.active
          or new.business_id is distinct from old.business_id or new.user_id is distinct from old.user_id)
     and not public.can_manage(old.business_id) then
    raise exception 'only owners and admins change roles' using errcode = '42501';
  end if;
  -- The first owner of a brand-new business (create_business) needs no approval.
  if auth.uid() is not null and tg_op in ('UPDATE', 'INSERT') and new.role = 'owner'
     and (tg_op = 'INSERT' or old.role <> 'owner')
     and not public.has_role(new.business_id, array['owner']::public.member_role[])
     and exists (select 1 from public.business_members
                  where business_id = new.business_id and role = 'owner' and active) then
    raise exception 'only owners appoint owners' using errcode = '42501';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (select 1 from public.business_members
                      where business_id = old.business_id and role = 'owner' and active and user_id <> old.user_id) then
    raise exception 'a business needs an owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger business_members_guard before insert or update or delete on public.business_members
  for each row execute function public.business_members_guard();

-- business_clients ------------------------------------------------------------
create policy "business_clients: staff" on public.business_clients for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "business_clients: self read" on public.business_clients for select using (client_id = auth.uid());

create policy "client_notes: staff" on public.client_notes for all
  using (public.is_member(business_id))
  with check (public.is_member(business_id)
              and exists (select 1 from public.business_clients bc where bc.business_id = client_notes.business_id
                          and bc.client_id = client_notes.client_id));

create policy "intakes: client own" on public.client_intakes for all
  using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(business_id));
create policy "intakes: staff read" on public.client_intakes for select using (public.is_member(business_id));

-- scheduling --------------------------------------------------------------------
create policy "session_types: clients" on public.session_types for select using (active and public.is_client_of(business_id));
create policy "session_types: staff" on public.session_types for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy "availability_rules: read" on public.availability_rules for select
  using (public.is_member(business_id) or public.is_client_of(business_id));
create policy "availability_rules: write" on public.availability_rules for all
  using (public.can_manage(business_id) or (coach_id = auth.uid() and public.is_member(business_id)))
  with check (public.can_manage(business_id) or (coach_id = auth.uid() and public.is_member(business_id)));

create policy "availability_overrides: staff read" on public.availability_overrides for select using (public.is_member(business_id));
create policy "availability_overrides: write" on public.availability_overrides for all
  using (public.can_manage(business_id) or (coach_id = auth.uid() and public.is_member(business_id)))
  with check (public.can_manage(business_id) or (coach_id = auth.uid() and public.is_member(business_id)));

create policy "bookings: staff" on public.bookings for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "bookings: client own" on public.bookings for select using (client_id = auth.uid());

create policy "waitlist: staff" on public.waitlist_entries for select using (public.is_member(business_id));
create policy "waitlist: client own" on public.waitlist_entries for select using (client_id = auth.uid());

-- commerce ------------------------------------------------------------------------
create policy "offerings: clients" on public.offerings for select using (active and public.is_client_of(business_id));
create policy "offerings: staff read" on public.offerings for select using (public.is_member(business_id));
create policy "offerings: managers write" on public.offerings for all
  using (public.can_manage(business_id)) with check (public.can_manage(business_id));

create policy "subscriptions: client own" on public.subscriptions for select using (client_id = auth.uid());
create policy "subscriptions: staff" on public.subscriptions for select using (public.is_member(business_id));

create policy "payments: client own" on public.payments for select using (client_id = auth.uid());
create policy "payments: managers" on public.payments for select using (public.can_manage(business_id));
create policy "payments: own coaching" on public.payments for select
  using (coach_id = auth.uid() and public.is_member(business_id));

create policy "credits: client own" on public.credit_ledger for select using (client_id = auth.uid());
create policy "credits: staff" on public.credit_ledger for select using (public.is_member(business_id));
-- stripe_events, platform_fees, sms_opt_outs: no policies -> service role only.

-- leads ------------------------------------------------------------------------------
create policy "lead_magnets: staff" on public.lead_magnets for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "leads: staff" on public.leads for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "lead_events: staff" on public.lead_events for all
  using (exists (select 1 from public.leads l where l.id = lead_id and public.is_member(l.business_id)))
  with check (exists (select 1 from public.leads l where l.id = lead_id and public.is_member(l.business_id)));

-- training -------------------------------------------------------------------------------
create policy "exercises: read" on public.exercises for select
  using (business_id is null or public.is_member(business_id) or public.is_client_of(business_id));
create policy "exercises: staff write" on public.exercises for all
  using (business_id is not null and public.is_member(business_id))
  with check (business_id is not null and public.is_member(business_id));

create or replace function public.can_view_program(p_program uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.programs p
                  where p.id = p_program and (p.client_id = auth.uid() or public.is_member(p.business_id)))
$$;
create or replace function public.can_edit_program(p_program uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.programs p where p.id = p_program and public.is_member(p.business_id))
$$;

create policy "programs: client own" on public.programs for select using (client_id = auth.uid());
create policy "programs: staff" on public.programs for all
  using (public.is_member(business_id))
  with check (public.is_member(business_id) and (client_id is null or exists (
    select 1 from public.business_clients bc where bc.business_id = programs.business_id and bc.client_id = programs.client_id)));

create policy "program_workouts: view" on public.program_workouts for select using (public.can_view_program(program_id));
create policy "program_workouts: staff write" on public.program_workouts for all
  using (public.can_edit_program(program_id)) with check (public.can_edit_program(program_id));

create policy "workout_exercises: view" on public.workout_exercises for select
  using (exists (select 1 from public.program_workouts w where w.id = workout_id and public.can_view_program(w.program_id)));
create policy "workout_exercises: staff write" on public.workout_exercises for all
  using (exists (select 1 from public.program_workouts w where w.id = workout_id and public.can_edit_program(w.program_id)))
  with check (exists (select 1 from public.program_workouts w where w.id = workout_id and public.can_edit_program(w.program_id)));

-- Client-owned records: the client writes, staff of that business read (and reply).
do $$
declare t text;
begin
  foreach t in array array['workout_logs', 'program_feedback', 'check_ins'] loop
    execute format($f$create policy "%1$s: client own" on public.%1$I for all
      using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(business_id))$f$, t);
    execute format($f$create policy "%1$s: staff read" on public.%1$I for select using (public.is_member(business_id))$f$, t);
    execute format($f$create policy "%1$s: staff reply" on public.%1$I for update
      using (public.is_member(business_id)) with check (public.is_member(business_id))$f$, t);
  end loop;
  foreach t in array array['body_metrics', 'progress_photos'] loop
    execute format($f$create policy "%1$s: client own" on public.%1$I for all
      using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(business_id))$f$, t);
    execute format($f$create policy "%1$s: staff read" on public.%1$I for select using (public.is_member(business_id))$f$, t);
  end loop;
  foreach t in array array['goals', 'habits'] loop
    execute format($f$create policy "%1$s: client own" on public.%1$I for all
      using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(business_id))$f$, t);
    execute format($f$create policy "%1$s: staff" on public.%1$I for all
      using (public.is_member(business_id))
      with check (public.is_member(business_id) and exists (select 1 from public.business_clients bc
        where bc.business_id = %1$I.business_id and bc.client_id = %1$I.client_id))$f$, t);
  end loop;
end $$;

create policy "set_logs: via log" on public.set_logs for all
  using (exists (select 1 from public.workout_logs l where l.id = workout_log_id
                  and (l.client_id = auth.uid() or public.is_member(l.business_id))))
  with check (exists (select 1 from public.workout_logs l where l.id = workout_log_id and l.client_id = auth.uid()));

create policy "habit_logs: via habit" on public.habit_logs for all
  using (exists (select 1 from public.habits h where h.id = habit_id
                  and (h.client_id = auth.uid() or public.is_member(h.business_id))))
  with check (exists (select 1 from public.habits h where h.id = habit_id and h.client_id = auth.uid()));

-- communication -------------------------------------------------------------------------
create policy "conversations: members read" on public.conversations for select
  using (client_id = auth.uid() or public.is_member(business_id));
revoke insert, update, delete on public.conversations from authenticated;   -- RPCs only

create policy "messages: read" on public.messages for select using (public.is_conversation_member(conversation_id));
create policy "messages: send" on public.messages for insert
  with check (sender_id = auth.uid() and kind <> 'system' and public.is_conversation_member(conversation_id));
create policy "messages: edit own" on public.messages for update
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
revoke update on public.messages from authenticated;
grant update (body, edited_at, deleted_at) on public.messages to authenticated;

create policy "video_submissions: client own" on public.video_submissions for all
  using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(business_id));
create policy "video_submissions: staff" on public.video_submissions for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));

create policy "video_comments: read" on public.video_comments for select
  using (exists (select 1 from public.video_submissions v where v.id = submission_id
                  and (v.client_id = auth.uid() or public.is_member(v.business_id))));
create policy "video_comments: write" on public.video_comments for insert
  with check (author_id = auth.uid() and exists (select 1 from public.video_submissions v where v.id = submission_id
                  and (v.client_id = auth.uid() or public.is_member(v.business_id))));
create policy "video_comments: delete own" on public.video_comments for delete using (author_id = auth.uid());

create policy "notifications: own" on public.notifications for select using (user_id = auth.uid());
create policy "notifications: mark read" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "broadcasts: managers" on public.broadcasts for all
  using (public.can_manage(business_id)) with check (public.can_manage(business_id));

create policy "testimonials: clients read approved" on public.testimonials for select
  using (approved and public.is_client_of(business_id));
create policy "testimonials: staff" on public.testimonials for all
  using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "testimonials: client submit" on public.testimonials for insert
  with check (client_id = auth.uid() and approved = false and public.is_client_of(business_id));

create policy "sms: staff read" on public.sms_messages for select using (public.is_member(business_id));

-- Anonymous API access: nothing. (Public pages are server-rendered.)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Function execute rights
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Server-only (service role).
  foreach f in array array[
    'public.reserve_booking(uuid, uuid, timestamptz, uuid, text, text, text, public.booking_status, public.payment_method_kind, int, text, uuid, uuid)',
    'public.reschedule_booking(uuid, timestamptz, uuid, uuid)',
    'public.expire_booking_holds()',
    'public.consume_credits(uuid, uuid, uuid, int, uuid)',
    'public.refund_booking_credits(uuid)',
    'public.debit_credits(uuid, uuid, int, text, text, uuid, uuid)',
    'public.capture_lead(jsonb)',
    'public.unsubscribe_lead(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Signed-in callers (each checks access itself or runs under RLS).
  foreach f in array array[
    'public.credit_balance(uuid, uuid, uuid)',
    'public.credit_grants_remaining(uuid, uuid)',
    'public.outstanding_credits(uuid)',
    'public.client_credit_balances(uuid)',
    'public.assign_program(uuid, uuid, date)',
    'public.duplicate_program_workout(uuid, int, int)',
    'public.copy_program_week(uuid, int, int[], boolean)',
    'public.duplicate_program(uuid, text)',
    'public.log_workout(jsonb, jsonb)',
    'public.ensure_conversation(uuid, uuid)',
    'public.mark_conversation_read(uuid)',
    'public.conversation_inbox(uuid)',
    'public.lead_magnet_stats(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Realtime for chat, notifications, comments and read receipts.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications,
      public.video_comments, public.conversations;
  end if;
end $$;
