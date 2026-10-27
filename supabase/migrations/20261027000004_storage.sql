-- Private storage buckets. Object paths start with the owning user's id so
-- policies can check folder ownership: <client_id>/<file>.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('form-videos', 'form-videos', false, 524288000),      -- 500 MB
  ('chat-media', 'chat-media', false, 104857600),        -- 100 MB
  ('progress-photos', 'progress-photos', false, 20971520),
  ('lead-magnets', 'lead-magnets', false, 52428800),     -- served via signed URLs
  ('public-media', 'public-media', true, 20971520)       -- avatars, covers, exercise thumbs
on conflict (id) do nothing;

-- Owner folder access (clients upload their own videos/photos/chat files).
create policy "own folder read" on storage.objects for select
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos')
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own folder write" on storage.objects for insert
  with check (bucket_id in ('form-videos', 'chat-media', 'progress-photos', 'public-media')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own folder delete" on storage.objects for delete
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos', 'public-media')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- Trainers read their clients' folders.
create policy "trainer reads client media" on storage.objects for select
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos')
         and public.is_trainer_of(((storage.foldername(name))[1])::uuid));

-- Clients read media their trainer sent them in chat (trainer folder).
create policy "client reads trainer chat media" on storage.objects for select
  using (bucket_id = 'chat-media'
         and public.is_client_of(((storage.foldername(name))[1])::uuid));

create policy "public media read" on storage.objects for select using (bucket_id = 'public-media');

-- Lead magnets: trainers manage their own; downloads happen via signed URLs.
create policy "trainer manages lead magnets" on storage.objects for all
  using (bucket_id = 'lead-magnets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'lead-magnets' and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_staff());
