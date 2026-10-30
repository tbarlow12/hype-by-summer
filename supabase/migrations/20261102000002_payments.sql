-- Payments: commission report (revenue by coach over a date range).
--
-- Runs as the caller (security invoker), so the payments RLS applies:
-- owners/admins get every coach, a coach gets only payments attributed to
-- them, anyone else gets nothing. Payments without a coach are reported
-- under coach_id = null ("unassigned").

create or replace function public.coach_revenue_report(
  p_business uuid, p_from timestamptz, p_to timestamptz
) returns table (
  coach_id uuid,
  payments int,
  gross_cents bigint,
  refunded_cents bigint,
  net_cents bigint,
  platform_fee_cents bigint
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.coach_id,
         count(*)::int,
         coalesce(sum(p.amount_cents), 0)::bigint,
         coalesce(sum(p.amount_refunded_cents), 0)::bigint,
         coalesce(sum(greatest(p.amount_cents - p.amount_refunded_cents, 0)), 0)::bigint,
         coalesce(sum(p.platform_fee_cents), 0)::bigint
    from public.payments p
   where p.business_id = p_business
     and p.status in ('succeeded', 'partially_refunded', 'refunded')
     and p.paid_at >= p_from and p.paid_at < p_to
   group by p.coach_id
$$;
revoke execute on function public.coach_revenue_report from public, anon;
grant execute on function public.coach_revenue_report to authenticated, service_role;
