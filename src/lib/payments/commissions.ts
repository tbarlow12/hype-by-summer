import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName } from "@/lib/format";
import { commissionLines, type CommissionLine, type DateRange } from "@/lib/payments/report";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Revenue by coach for a range. Runs as the signed-in user, so RLS decides
 * the scope: managers get every coach, a coach gets only their own line.
 */
export async function loadCommissionReport(
  supabase: SupabaseClient<Database>,
  businessId: string,
  range: Pick<DateRange, "fromUtc" | "toUtc">,
): Promise<CommissionLine[]> {
  const { data, error } = await supabase.rpc("coach_revenue_report", {
    p_business: businessId,
    p_from: range.fromUtc.toISOString(),
    p_to: range.toUtc.toISOString(),
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = rows.map((r) => r.coach_id).filter((x): x is string => Boolean(x));
  // Names of coaches who earned in this business (incl. ones who have since left).
  const { data: people } = ids.length
    ? await createAdminClient().from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, displayName(p)]));
  return commissionLines(rows, names);
}
