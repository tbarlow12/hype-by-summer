"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { formatDateTime } from "@/lib/format";
import { clientRelationship, coachesForType, getCoach, listCoaches } from "@/lib/scheduling/availability";
import { bookRecurring } from "@/lib/scheduling/book";
import { cancelBooking, markBookingOutcome, rescheduleBooking } from "@/lib/scheduling/lifecycle";
import { staffBooking } from "@/lib/scheduling/staff";
import { timeToMinutes, zonedTimeToUtc } from "@/lib/scheduling/tz";

/** A booking of this business the signed-in staff member may change. */
async function actionableBooking(id: string) {
  const found = await staffBooking(id);
  if (!found) return { error: fail("Booking not found.") } as const;
  if (!found.canAct) return { error: fail("Only the assigned coach or a manager can change this booking.") } as const;
  return found;
}

function refresh(id?: string) {
  revalidatePath("/coach/calendar");
  if (id) revalidatePath(`/coach/calendar/${id}`);
}

export async function setOutcomeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({ id: z.uuid(), status: z.enum(["completed", "no_show", "confirmed"]), charge_fee: zfd.checkbox() }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const found = await actionableBooking(parsed.data.id);
  if ("error" in found) return found.error;
  const res = await markBookingOutcome({
    bookingId: found.booking.id,
    businessId: found.staff.business.id,
    status: parsed.data.status,
    // Charging fees is a money action: managers only.
    chargeNoShowFee: parsed.data.charge_fee && isManager(found.staff.membership),
  });
  if (!res.ok) return fail(res.error ?? "Couldn't update.");
  refresh(found.booking.id);
  return ok(res.message);
}

export async function staffCancelAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), refund: zfd.checkbox(), reason: z.string().trim().max(500).optional() }), formData);
  if (parsed.error) return parsed.error;
  const found = await actionableBooking(parsed.data.id);
  if ("error" in found) return found.error;
  const res = await cancelBooking({
    bookingId: found.booking.id,
    actor: { kind: "staff", userId: found.staff.profile.id },
    // Withholding a refund is a money decision: only managers may; otherwise the client is refunded.
    staffRefund: isManager(found.staff.membership) ? parsed.data.refund : true,
    reason: parsed.data.reason || undefined,
  });
  if (!res.ok) return fail(res.error);
  refresh(found.booking.id);
  return ok(res.message);
}

export async function saveCoachNotesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), coach_notes: z.string().max(5000) }), formData);
  if (parsed.error) return parsed.error;
  const found = await actionableBooking(parsed.data.id);
  if ("error" in found) return found.error;
  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ coach_notes: parsed.data.coach_notes.trim() || null })
    .eq("id", found.booking.id)
    .eq("business_id", found.staff.business.id);
  if (error) return fail(error.message);
  refresh(found.booking.id);
  return ok("Notes saved.");
}

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time");

/** Move a booking to another time and/or reassign it to another coach of the session type. */
export async function staffRescheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), starts_at_local: localDateTime, coach_id: z.uuid().optional() }), formData);
  if (parsed.error) return parsed.error;
  const found = await actionableBooking(parsed.data.id);
  if ("error" in found) return found.error;
  const { staff } = found;
  const [date, time] = parsed.data.starts_at_local.split("T") as [string, string];
  const startsAt = zonedTimeToUtc(date, timeToMinutes(time), staff.profile.timezone).toISOString();
  const coachId = parsed.data.coach_id ?? found.booking.coach_id;
  if (coachId !== found.booking.coach_id && !(await getCoach(staff.business.id, coachId))) return fail("Choose a coach on your team.");
  const res = await rescheduleBooking({
    bookingId: found.booking.id,
    startsAt,
    coachId,
    actor: { kind: "staff", userId: staff.profile.id },
    requireOfferedSlot: false,
  });
  if (!res.ok) return fail(res.error);
  refresh(found.booking.id);
  redirect(`/coach/calendar/${res.booking.id}`);
}

const bookForClientSchema = z.object({
  client_id: z.uuid("Choose a client"),
  session_type_id: z.uuid("Choose a session type"),
  coach: z.union([z.literal("any"), z.uuid()]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  weeks: z.coerce.number().int().min(1).max(52),
  payment: z.enum(["pay_later", "credits", "free"]),
  notes: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(32).optional(),
  sms_opt_in: zfd.checkbox(),
});

export async function bookForClientAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  const parsed = parseForm(bookForClientSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const supabase = await createClient();
  const [relationship, { data: sessionType }, coaches] = await Promise.all([
    clientRelationship(v.client_id, business.id),
    supabase.from("session_types").select("*").eq("id", v.session_type_id).eq("business_id", business.id).maybeSingle(),
    listCoaches(business.id, { bookableOnly: true }),
  ]);
  if (!relationship) return fail("That client isn't on your roster.");
  if (!sessionType || !sessionType.active) return fail("Choose an active session type.");
  const coachId = v.coach === "any" ? null : v.coach;
  if (coachId && !coachesForType(sessionType, coaches).some((c) => c.id === coachId)) return fail("That coach doesn't run this session type.");

  // Times are entered in the signed-in staff member's timezone.
  const tz = profile.timezone;
  const first = zonedTimeToUtc(v.date, timeToMinutes(v.time), tz);
  if (first.getTime() <= Date.now()) return fail("Pick a time in the future.");
  const result = await bookRecurring({
    business,
    sessionType,
    coachId,
    preferredCoachId: relationship.primary_coach_id,
    firstStartsAt: first.toISOString(),
    weeks: v.weeks,
    clientId: v.client_id,
    payment: v.payment,
    notes: v.notes || undefined,
    phone: v.phone || undefined,
    smsOptIn: v.sms_opt_in,
    timezone: tz,
  });
  revalidatePath("/coach/calendar");
  if (result.booked.length === 0) {
    return fail(result.skipped[0]?.error ?? "Nothing was booked.");
  }
  const skipped = result.skipped.map((s) => `${formatDateTime(s.startsAt, tz, "MMM d")}: ${s.error}`);
  if (result.booked.length === 1 && skipped.length === 0) redirect(`/coach/calendar/${result.booked[0]!.id}`);
  return ok(
    `Booked ${result.booked.length} session${result.booked.length === 1 ? "" : "s"}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.join("; ")}` : ""}`,
  );
}
