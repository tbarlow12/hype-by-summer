-- Cross-cutting hardening applied after the feature migrations.

-- credit_balance: callers may only ask about themselves (as client), or about a
-- client they train. The service role (no auth.uid()) is unrestricted.
create or replace function public.credit_balance(
  p_client uuid, p_trainer uuid, p_session_type uuid default null
) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null
     and auth.uid() <> p_client
     and not (auth.uid() = p_trainer and public.is_trainer_of(p_client))
     and not public.current_role_is('admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(sum(g.delta - coalesce(used.amount, 0)), 0)::int
      from public.credit_ledger g
      left join lateral (
        select -sum(d.delta) as amount from public.credit_ledger d where d.grant_id = g.id
      ) used on true
     where g.client_id = p_client and g.trainer_id = p_trainer and g.delta > 0
       and (g.expires_at is null or g.expires_at > now())
       and (p_session_type is null or g.session_type_ids is null or p_session_type = any (g.session_type_ids))
  );
end $$;
revoke execute on function public.credit_balance from public, anon;
grant execute on function public.credit_balance to authenticated, service_role;
