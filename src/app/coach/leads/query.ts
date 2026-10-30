import "server-only";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { dueWindow, type LeadFilters, type OwnerFilter } from "@/lib/leads/filters";

export type LeadScope = { businessId: string; userId: string; owner: OwnerFilter };

/** Applies the owner scope ("mine" / "all" / "unassigned") to a leads query. */
export function scoped<Q extends { eq(c: "assigned_coach_id", v: string): Q; is(c: "assigned_coach_id", v: null): Q }>(
  query: Q,
  scope: Pick<LeadScope, "userId" | "owner">,
): Q {
  if (scope.owner === "mine") return query.eq("assigned_coach_id", scope.userId);
  if (scope.owner === "unassigned") return query.is("assigned_coach_id", null);
  return query;
}

/** Leads of the current business matching the CRM filters and owner scope (RLS + explicit business filter). */
export async function fetchLeads(scope: LeadScope, filters: LeadFilters, timeZone: string, opts: { limit?: number } = {}) {
  const supabase = await createClient();
  let query = scoped(supabase.from("leads").select("*").eq("business_id", scope.businessId), scope);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.magnet) query = query.eq("lead_magnet_id", filters.magnet);
  if (filters.campaign) query = query.eq("utm_campaign", filters.campaign);
  if (filters.due) {
    const now = new Date();
    const endOfToday = fromZonedTime(`${formatInTimeZone(now, timeZone, "yyyy-MM-dd")}T23:59:59.999`, timeZone);
    const w = dueWindow(filters.due, now, endOfToday);
    query = w.none ? query.is("next_follow_up_at", null) : query.lte("next_follow_up_at", w.before!);
    if (!w.none) query = query.not("status", "in", "(converted,lost,unsubscribed)");
  }
  if (filters.q) {
    const term = `%${filters.q.replace(/[%_,()]/g, "")}%`;
    query = query.or(
      ["first_name", "last_name", "email", "phone", "utm_campaign"].map((c) => `${c}.ilike.${term}`).join(","),
    );
  }

  switch (filters.sort) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "score":
      query = query.order("score", { ascending: false }).order("created_at", { ascending: false });
      break;
    case "follow_up":
      query = query.order("next_follow_up_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      break;
    case "name":
      query = query.order("first_name", { ascending: true, nullsFirst: false }).order("email");
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }
  return query.limit(opts.limit ?? 500);
}
