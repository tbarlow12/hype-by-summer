import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { getBusiness } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedDownloadUrl } from "@/lib/payments/shared";

/** GET /api/downloads/<paymentId>: fresh short-lived link to a file bought from this business. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/downloads/[paymentId]">) {
  const { paymentId } = await ctx.params;
  const business = await getBusiness();
  if (!business) return new NextResponse("Not found", { status: 404 });
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/api/downloads/${paymentId}`)}`, request.url));
  }
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return new NextResponse("Not found", { status: 404 });

  // RLS: clients only see their own payments; scoped to the business whose site this is.
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, client_id, status, purpose, offering_id")
    .eq("id", paymentId)
    .eq("business_id", business.id)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!payment || payment.purpose !== "one_time" || !payment.offering_id) return new NextResponse("Not found", { status: 404 });
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    return new NextResponse("This purchase isn't available for download.", { status: 403 });
  }

  const admin = createAdminClient();
  const { data: offering } = await admin
    .from("offerings")
    .select("digital_file_path, digital_file_name")
    .eq("id", payment.offering_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!offering?.digital_file_path) return new NextResponse("No file for this purchase.", { status: 404 });

  const url = await signedDownloadUrl(admin, offering.digital_file_path, offering.digital_file_name, 120);
  if (!url) return new NextResponse("Download unavailable, please try again shortly.", { status: 503 });
  return NextResponse.redirect(url, 303);
}
