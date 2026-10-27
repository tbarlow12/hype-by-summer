import type { NextRequest } from "next/server";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { getTrainerBySlug } from "@/lib/trainer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBookableSessionType, getSlots, isClientOfTrainer } from "@/lib/scheduling/availability";
import { addDays, daysBetween, isValidTimeZone, startOfLocalDay } from "@/lib/scheduling/tz";

export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  trainer: z.string().min(1).max(64),
  session: z.string().min(1).max(64),
  from: date,
  to: date,
  tz: z.string().max(64).optional(),
  reschedule: z.string().regex(/^[a-f0-9]{16,64}$/).optional(),
});

/**
 * GET /api/availability?trainer=<slug>&session=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD[&tz=Area/City][&reschedule=<manage token>]
 * Dates are inclusive and interpreted in `tz` (default: trainer timezone).
 */
export async function GET(request: NextRequest) {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_params", detail: parsed.error.issues[0]?.message }, { status: 400 });
  const q = parsed.data;
  const span = daysBetween(q.from, q.to);
  if (span < 0 || span > 62) return Response.json({ error: "invalid_range" }, { status: 400 });

  const trainer = await getTrainerBySlug(q.trainer);
  if (!trainer) return Response.json({ error: "trainer_not_found" }, { status: 404 });
  const trainerTz = trainer.profiles?.timezone ?? "America/Denver";
  const tz = q.tz && isValidTimeZone(q.tz) ? q.tz : trainerTz;

  const profile = await getProfile();
  const includeClientsOnly = Boolean(profile && (await isClientOfTrainer(profile.id, trainer.trainer_id)));
  const sessionType = await getBookableSessionType(trainer.trainer_id, q.session, { includeClientsOnly });
  if (!sessionType) return Response.json({ error: "session_not_found" }, { status: 404 });

  let excludeBookingId: string | undefined;
  if (q.reschedule) {
    const { data } = await createAdminClient()
      .from("bookings")
      .select("id, session_type_id")
      .eq("manage_token", q.reschedule)
      .maybeSingle();
    if (data?.session_type_id === sessionType.id) excludeBookingId = data.id;
  }

  const { days } = await getSlots({
    trainerId: trainer.trainer_id,
    timezone: trainerTz,
    sessionType,
    from: startOfLocalDay(q.from, tz),
    to: startOfLocalDay(addDays(q.to, 1), tz),
    displayTimezone: tz,
    excludeBookingId,
    includeFull: sessionType.capacity > 1,
  });

  return Response.json(
    {
      trainerTimezone: trainerTz,
      timezone: tz,
      sessionType: { slug: sessionType.slug, durationMinutes: sessionType.duration_minutes, capacity: sessionType.capacity },
      days,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
