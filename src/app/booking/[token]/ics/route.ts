import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingIcs, loadBookingContext } from "@/lib/scheduling/lifecycle";

export const dynamic = "force-dynamic";

/** GET /booking/<manage token>/ics: calendar file for one booking. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/booking/[token]/ics">) {
  const { token } = await ctx.params;
  if (!/^[a-f0-9]{16,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const { data } = await createAdminClient().from("bookings").select("id").eq("manage_token", token).maybeSingle();
  const booking = data ? await loadBookingContext(data.id) : null;
  if (!booking) return new Response("Not found", { status: 404 });
  const cancelled = ["cancelled", "late_cancelled"].includes(booking.booking.status);
  return new Response(bookingIcs(booking, { cancelled }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="session.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
