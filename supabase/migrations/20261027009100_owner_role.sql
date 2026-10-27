-- Every signup is a client. The coach (trainer) role is granted by the app to
-- the account whose email matches OWNER_EMAIL (see src/lib/auth.ts), so a
-- stranger can't claim the business by signing up first on a fresh deploy.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone',
    'client'
  )
  on conflict (id) do nothing;

  -- Link guest bookings made with this email.
  update public.bookings set client_id = new.id
   where client_id is null and guest_email = new.email;

  return new;
end $$;
