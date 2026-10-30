-- Platform admin: per-business totals for the /admin dashboard in one query
-- (members, clients, money processed, platform fees earned). Service role
-- only; the app checks requirePlatformAdmin() before calling it.

create or replace function public.platform_business_stats()
returns table (
  business_id uuid,
  members int,
  clients int,
  processed_cents bigint,
  refunded_cents bigint,
  fees_cents bigint,
  fees_refunded_cents bigint,
  last_paid_at timestamptz
)
language sql stable security definer set search_path = public, extensions as $$
  select
    b.id,
    (select count(*) from public.business_members m where m.business_id = b.id and m.active)::int,
    (select count(*) from public.business_clients c where c.business_id = b.id and c.status <> 'archived')::int,
    coalesce(p.processed, 0)::bigint,
    coalesce(p.refunded, 0)::bigint,
    coalesce(f.fees, 0)::bigint,
    coalesce(f.fees_refunded, 0)::bigint,
    p.last_paid_at
  from public.businesses b
  left join lateral (
    select sum(amount_cents) as processed, sum(amount_refunded_cents) as refunded, max(paid_at) as last_paid_at
    from public.payments
    where payments.business_id = b.id and status in ('succeeded', 'refunded', 'partially_refunded')
  ) p on true
  left join lateral (
    select sum(amount_cents) as fees, sum(amount_refunded_cents) as fees_refunded
    from public.platform_fees
    where platform_fees.business_id = b.id
  ) f on true
$$;
revoke execute on function public.platform_business_stats() from public, anon, authenticated;
grant execute on function public.platform_business_stats() to service_role;
