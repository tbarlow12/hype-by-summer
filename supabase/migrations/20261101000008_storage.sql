-- Storage buckets. Object paths start with an owner folder:
--   <user_id>/...      a person's uploads (form videos, progress photos, chat files, avatar)
--   <business_id>/...  a business's files (staff chat files, lead magnets, digital products, brand images)

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('form-videos', 'form-videos', false, 524288000),       -- 500 MB
  ('chat-media', 'chat-media', false, 104857600),         -- 100 MB
  ('progress-photos', 'progress-photos', false, 20971520),
  ('lead-magnets', 'lead-magnets', false, 52428800),      -- served via signed URLs
  ('digital-products', 'digital-products', false, 524288000),
  ('public-media', 'public-media', true, 20971520)        -- avatars, logos, covers
on conflict (id) do nothing;

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function public.object_owner(p_name text) returns uuid
language sql immutable as $$
  select public.try_uuid((storage.foldername(p_name))[1])
$$;

-- A person's own folder.
create policy "own folder read" on storage.objects for select
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos', 'public-media') and public.object_owner(name) = auth.uid());
create policy "own folder write" on storage.objects for insert
  with check (bucket_id in ('form-videos', 'chat-media', 'progress-photos', 'public-media')
              and public.object_owner(name) = auth.uid());
create policy "own folder delete" on storage.objects for delete
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos', 'public-media')
         and public.object_owner(name) = auth.uid());

-- Staff read the media of their business's clients.
create policy "staff read client media" on storage.objects for select
  using (bucket_id in ('form-videos', 'chat-media', 'progress-photos')
         and public.is_staff_for_client(public.object_owner(name)));

-- Staff manage their business's folder.
create policy "staff business files" on storage.objects for all
  using (bucket_id in ('chat-media', 'lead-magnets', 'digital-products', 'public-media')
         and public.is_member(public.object_owner(name)))
  with check (bucket_id in ('chat-media', 'lead-magnets', 'digital-products', 'public-media')
              and public.is_member(public.object_owner(name)));

-- Clients read files their business's staff sent in chat.
create policy "clients read business chat media" on storage.objects for select
  using (bucket_id = 'chat-media' and public.is_client_of(public.object_owner(name)));

-- public-media is a public bucket: its files load by URL without any policy,
-- and nobody may list it (that would enumerate businesses).
