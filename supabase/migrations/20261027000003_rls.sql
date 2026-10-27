-- Row level security. Money, credits, leads and booking creation are written
-- only by the server (service role); RLS here governs what signed-in users can
-- read and the self-service writes they're allowed.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'trainer_profiles', 'trainer_clients', 'client_notes', 'client_intakes', 'session_types',
    'availability_rules', 'availability_overrides', 'bookings', 'waitlist_entries', 'offerings',
    'subscriptions', 'payments', 'credit_ledger', 'stripe_events', 'lead_magnets', 'leads',
    'lead_events', 'exercises', 'programs', 'program_workouts', 'workout_exercises',
    'workout_logs', 'set_logs', 'program_feedback', 'check_ins', 'body_metrics',
    'progress_photos', 'goals', 'habits', 'habit_logs', 'conversations', 'messages',
    'video_submissions', 'video_comments', 'notifications', 'broadcasts', 'testimonials'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles ------------------------------------------------------------------
create policy "profiles: self read" on public.profiles for select
  using (id = auth.uid());
create policy "profiles: trainer reads clients" on public.profiles for select
  using (public.is_trainer_of(id));
create policy "profiles: client reads own trainers" on public.profiles for select
  using (public.is_client_of(id));
create policy "profiles: staff read all" on public.profiles for select
  using (public.current_role_is('admin'));
create policy "profiles: self update" on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
-- Prevent self-promotion / tampering with billing linkage.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, phone, timezone, date_of_birth, marketing_opt_in, sms_opt_in, onboarded_at)
  on public.profiles to authenticated;

-- trainer_profiles: public storefront ----------------------------------------
create policy "trainer_profiles: public read" on public.trainer_profiles for select using (true);
create policy "trainer_profiles: owner write" on public.trainer_profiles for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
-- The ICS feed token is a secret: no API role may select it (server reads it
-- with the service role).
revoke select on public.trainer_profiles from anon, authenticated;
grant select (trainer_id, slug, business_name, headline, bio, specialties, certifications,
  instagram_handle, website_url, brand_color, cover_image_url, default_location,
  cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents, refund_on_cancel,
  accepting_new_clients, created_at, updated_at) on public.trainer_profiles to anon, authenticated;

-- trainer_clients -------------------------------------------------------------
create policy "trainer_clients: trainer all" on public.trainer_clients for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "trainer_clients: client read" on public.trainer_clients for select
  using (client_id = auth.uid());
create policy "client_notes: trainer only" on public.client_notes for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid() and public.is_trainer_of(client_id));

-- client_intakes --------------------------------------------------------------
create policy "intakes: client own" on public.client_intakes for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "intakes: trainer read" on public.client_intakes for select
  using (trainer_id = auth.uid());

-- session_types / availability: public read for booking pages ------------------
create policy "session_types: public read active" on public.session_types for select
  using (active and not clients_only);
create policy "session_types: clients read members-only" on public.session_types for select
  using (active and public.is_client_of(trainer_id));
create policy "session_types: owner all" on public.session_types for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

create policy "availability_rules: public read" on public.availability_rules for select using (true);
create policy "availability_rules: owner all" on public.availability_rules for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "availability_overrides: owner all" on public.availability_overrides for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

-- bookings --------------------------------------------------------------------
create policy "bookings: trainer all" on public.bookings for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "bookings: client read own" on public.bookings for select
  using (client_id = auth.uid());

create policy "waitlist: trainer read" on public.waitlist_entries for select
  using (exists (select 1 from public.session_types s where s.id = session_type_id and s.trainer_id = auth.uid()));
create policy "waitlist: client own" on public.waitlist_entries for select
  using (client_id = auth.uid());

-- commerce --------------------------------------------------------------------
create policy "offerings: public read active" on public.offerings for select using (active);
create policy "offerings: owner all" on public.offerings for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

create policy "subscriptions: client read own" on public.subscriptions for select using (client_id = auth.uid());
create policy "subscriptions: trainer read" on public.subscriptions for select using (trainer_id = auth.uid());

create policy "payments: client read own" on public.payments for select using (client_id = auth.uid());
create policy "payments: trainer read" on public.payments for select using (trainer_id = auth.uid());

create policy "credits: client read own" on public.credit_ledger for select using (client_id = auth.uid());
create policy "credits: trainer read" on public.credit_ledger for select using (trainer_id = auth.uid());
-- stripe_events: no policies -> service role only.

-- leads -----------------------------------------------------------------------
create policy "lead_magnets: public read active" on public.lead_magnets for select using (active);
create policy "lead_magnets: owner all" on public.lead_magnets for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "leads: owner all" on public.leads for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "lead_events: owner all" on public.lead_events for all
  using (exists (select 1 from public.leads l where l.id = lead_id and l.trainer_id = auth.uid()))
  with check (exists (select 1 from public.leads l where l.id = lead_id and l.trainer_id = auth.uid()));

-- training ----------------------------------------------------------------------
create policy "exercises: read global + own + my trainers" on public.exercises for select
  using (trainer_id is null or trainer_id = auth.uid() or public.is_client_of(trainer_id));
create policy "exercises: owner write" on public.exercises for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid() and public.is_staff());

create policy "programs: view" on public.programs for select
  using (trainer_id = auth.uid() or client_id = auth.uid());
create policy "programs: trainer write" on public.programs for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid() and (client_id is null or public.is_trainer_of(client_id)));

create policy "program_workouts: view" on public.program_workouts for select
  using (public.can_view_program(program_id));
create policy "program_workouts: trainer write" on public.program_workouts for all
  using (exists (select 1 from public.programs p where p.id = program_id and p.trainer_id = auth.uid()))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.trainer_id = auth.uid()));

create policy "workout_exercises: view" on public.workout_exercises for select
  using (public.can_view_workout(workout_id));
create policy "workout_exercises: trainer write" on public.workout_exercises for all
  using (exists (select 1 from public.program_workouts w join public.programs p on p.id = w.program_id
                  where w.id = workout_id and p.trainer_id = auth.uid()))
  with check (exists (select 1 from public.program_workouts w join public.programs p on p.id = w.program_id
                  where w.id = workout_id and p.trainer_id = auth.uid()));

create policy "workout_logs: client own" on public.workout_logs for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "workout_logs: trainer read" on public.workout_logs for select
  using (public.is_trainer_of(client_id));
create policy "workout_logs: trainer respond" on public.workout_logs for update
  using (public.is_trainer_of(client_id)) with check (public.is_trainer_of(client_id));

create policy "set_logs: via workout log" on public.set_logs for all
  using (exists (select 1 from public.workout_logs l where l.id = workout_log_id
                  and (l.client_id = auth.uid() or public.is_trainer_of(l.client_id))))
  with check (exists (select 1 from public.workout_logs l where l.id = workout_log_id and l.client_id = auth.uid()));

create policy "program_feedback: client own" on public.program_feedback for all
  using (client_id = auth.uid()) with check (client_id = auth.uid() and public.can_view_program(program_id));
create policy "program_feedback: trainer" on public.program_feedback for all
  using (exists (select 1 from public.programs p where p.id = program_id and p.trainer_id = auth.uid()))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.trainer_id = auth.uid()));

create policy "check_ins: client own" on public.check_ins for all
  using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(trainer_id));
create policy "check_ins: trainer" on public.check_ins for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

create policy "body_metrics: client own" on public.body_metrics for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "body_metrics: trainer read" on public.body_metrics for select
  using (public.is_trainer_of(client_id));
create policy "progress_photos: client own" on public.progress_photos for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "progress_photos: trainer read" on public.progress_photos for select
  using (public.is_trainer_of(client_id));

create policy "goals: client own" on public.goals for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "goals: trainer" on public.goals for all
  using (public.is_trainer_of(client_id)) with check (public.is_trainer_of(client_id));
create policy "habits: client own" on public.habits for all
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "habits: trainer" on public.habits for all
  using (public.is_trainer_of(client_id)) with check (public.is_trainer_of(client_id));
create policy "habit_logs: via habit" on public.habit_logs for all
  using (exists (select 1 from public.habits h where h.id = habit_id
                  and (h.client_id = auth.uid() or public.is_trainer_of(h.client_id))))
  with check (exists (select 1 from public.habits h where h.id = habit_id and h.client_id = auth.uid()));

-- communication ----------------------------------------------------------------
create policy "conversations: members read" on public.conversations for select
  using (auth.uid() in (trainer_id, client_id));
create policy "conversations: members mark read" on public.conversations for update
  using (auth.uid() in (trainer_id, client_id)) with check (auth.uid() in (trainer_id, client_id));

create policy "messages: members read" on public.messages for select
  using (public.is_conversation_member(conversation_id));
create policy "messages: members send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id) and kind <> 'system');
create policy "messages: sender edit" on public.messages for update
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create policy "video_submissions: client own" on public.video_submissions for all
  using (client_id = auth.uid()) with check (client_id = auth.uid() and public.is_client_of(trainer_id));
create policy "video_submissions: trainer" on public.video_submissions for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "video_comments: participants" on public.video_comments for select
  using (exists (select 1 from public.video_submissions v where v.id = submission_id
                  and auth.uid() in (v.client_id, v.trainer_id)));
create policy "video_comments: participants write" on public.video_comments for insert
  with check (author_id = auth.uid() and exists (
    select 1 from public.video_submissions v where v.id = submission_id and auth.uid() in (v.client_id, v.trainer_id)));
create policy "video_comments: author delete" on public.video_comments for delete
  using (author_id = auth.uid());

create policy "notifications: own" on public.notifications for select using (user_id = auth.uid());
create policy "notifications: mark read" on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "broadcasts: owner" on public.broadcasts for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

create policy "testimonials: public approved" on public.testimonials for select using (approved);
create policy "testimonials: owner" on public.testimonials for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "testimonials: client submit" on public.testimonials for insert
  with check (client_id = auth.uid() and approved = false and public.is_client_of(trainer_id));

-- Realtime for chat + notifications.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications, public.video_comments;
  end if;
end $$;
