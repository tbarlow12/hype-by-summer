import type { NextRequest } from "next/server";
import { z } from "zod";
import { getMembership, getProfile } from "@/lib/auth";
import { getBusiness } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { coachesForType, getBookableSessionType, getSlots, isClientOf, listCoaches } from "@/lib/scheduling/availability";
import { addDays, daysBetween, isValidTimeZone, startOfLocalDay } from "@/lib/scheduling/tz";

export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  session: z.string().min(1).max(64),
  coach: z.union([z.literal("any"), z.uuid()]).default("any"),
  /** Legacy: must equal the current business slug when given. */
  trainer: z.string().max(64).optional(),
  from: date,
  to: date,
  tz: z.string().max(64).optional(),
  reschedule: z.string().regex(/^[a-f0-9]{16,64}$/).optional(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * GET /api/availability?session=<slug>&coach=<any|coach id>&from=YYYY-MM-DD&to=YYYY-MM-DD[&tz=Area/City][&reschedule=<manage token>]
 * Open times for a session type of the business this host serves. Dates are
 * inclusive and interpreted in `tz` (default: the business timezone). With
 * coach=any, slots are the union across the type's coaches (`coachIds` lists
 * who is free). Rescheduling keeps the booking's coach.
 */
export async function GET(request: NextRequest) {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: "invalid_params", detail: parsed.error.issues[0]?.message }, 400);
  const q = parsed.data;
  const span = daysBetween(q.from, q.to);
  if (span < 0 || span > 62) return json({ error: "invalid_range" }, 400);

  const business = await getBusiness();
  if (!business) return json({ error: "not_found" }, 404);
  if (q.trainer && q.trainer.toLowerCase() !== business.slug.toLowerCase()) return json({ error: "not_found" }, 404);
  const tz = q.tz && isValidTimeZone(q.tz) ? q.tz : business.timezone;

  const [profile, membership] = await Promise.all([getProfile(), getMembership()]);
  const includeClientsOnly = Boolean(membership || (profile && (await isClientOf(profile.id, business.id))));
  const sessionType = await getBookableSessionType(business.id, q.session, { includeClientsOnly });
  if (!sessionType) return json({ error: "session_not_found" }, 404);
  const coaches = await listCoaches(business.id, { bookableOnly: true });

  let coachId: string | null = q.coach === "any" ? null : q.coach;
  let excludeBookingId: string | undefined;
  if (q.reschedule) {
    const { data } = await createAdminClient()
      .from("bookings")
      .select("id, session_type_id, coach_id")
      .eq("business_id", business.id)
      .eq("manage_token", q.reschedule)
      .maybeSingle();
    if (data?.session_type_id === sessionType.id) {
      excludeBookingId = data.id;
      coachId = data.coach_id;
    }
  }
  if (coachId && !coachesForType(sessionType, coaches).some((c) => c.id === coachId)) {
    return json({ error: "coach_not_found" }, 404);
  }

  const { days } = await getSlots({
    businessId: business.id,
    sessionType,
    coaches,
    coachId,
    from: startOfLocalDay(q.from, tz),
    to: startOfLocalDay(addDays(q.to, 1), tz),
    displayTimezone: tz,
    excludeBookingId,
    includeFull: sessionType.capacity > 1,
  });

  return json({
    timezone: tz,
    coach: coachId ?? "any",
    sessionType: { slug: sessionType.slug, durationMinutes: sessionType.duration_minutes, capacity: sessionType.capacity },
    days,
  });
}
