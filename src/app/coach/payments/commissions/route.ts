import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCommissionReport } from "@/lib/payments/commissions";
import { commissionCsv, parseDateRange } from "@/lib/payments/report";

/**
 * GET /coach/payments/commissions?from=yyyy-MM-dd&to=yyyy-MM-dd
 * Revenue by coach as CSV. Managers get every coach; a coach gets only
 * their own line (RLS on payments).
 */
export async function GET(request: Request) {
  const { business } = await requireStaff();
  const url = new URL(request.url);
  const range = parseDateRange({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }, business.timezone);
  const supabase = await createClient();
  const lines = await loadCommissionReport(supabase, business.id, range);
  const { data: currencyRow } = await supabase
    .from("payments")
    .select("currency")
    .eq("business_id", business.id)
    .not("paid_at", "is", null)
    .limit(1)
    .maybeSingle();
  const csv = commissionCsv(lines, range, currencyRow?.currency ?? "usd");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="revenue-by-coach-${range.from}-to-${range.to}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
