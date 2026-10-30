-- Clients & team: note authorship and primary-coach integrity.

-- Private notes show their author, so the author is always the writer:
-- staff insert notes as themselves; only the author or a manager edits or
-- deletes a note.
alter table public.client_notes alter column author_id set default auth.uid();

drop policy if exists "client_notes: staff" on public.client_notes;
create policy "client_notes: staff read" on public.client_notes for select
  using (public.is_member(business_id));
create policy "client_notes: staff write" on public.client_notes for insert
  with check (public.is_member(business_id)
              and author_id = auth.uid()
              and exists (select 1 from public.business_clients bc where bc.business_id = client_notes.business_id
                          and bc.client_id = client_notes.client_id));
create policy "client_notes: author or manager update" on public.client_notes for update
  using (public.is_member(business_id) and (author_id = auth.uid() or public.can_manage(business_id)))
  with check (public.is_member(business_id) and (author_id = auth.uid() or public.can_manage(business_id)));
create policy "client_notes: author or manager delete" on public.client_notes for delete
  using (public.is_member(business_id) and (author_id = auth.uid() or public.can_manage(business_id)));
-- Notes keep their author/client/business; only the text and pin change.
revoke update on public.client_notes from authenticated;
grant update (body, pinned) on public.client_notes to authenticated;

-- A client's primary coach is a member of that business.
create or replace function public.business_clients_check_coach() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.primary_coach_id is not null
     and (tg_op = 'INSERT' or new.primary_coach_id is distinct from old.primary_coach_id)
     and not exists (select 1 from public.business_members m
                      where m.business_id = new.business_id and m.user_id = new.primary_coach_id and m.active) then
    raise exception 'primary_coach_not_member' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger business_clients_check_coach before insert or update on public.business_clients
  for each row execute function public.business_clients_check_coach();
