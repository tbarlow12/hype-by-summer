"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { formatDateTime } from "@/lib/format";
import { bookRecurring } from "@/lib/scheduling/book";
import { cancelBooking, markBookingOutcome, rescheduleBooking } from "@/lib/scheduling/lifecycle";
import { timeToMinutes, zonedTimeToUtc } from "@/lib/scheduling/tz";

/** Verifies the booking belongs to the signed-in trainer (RLS + explicit filter). */
async function ownBooking(id: string) {
  const profile = await requireTrainer();
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select("id, trainer_id").eq("id", id).eq("trainer_id", profile.id).maybeSingle();
  return data ? { profile, booking: data } : null;
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
  const own = await ownBooking(parsed.data.id);
  if (!own) return fail("Booking not found.");
  const res = await markBookingOutcome({
    bookingId: own.booking.id,
    trainerId: own.profile.id,
    status: parsed.data.status,
    chargeNoShowFee: parsed.data.charge_fee,
  });
  if (!res.ok) return fail(res.error ?? "Couldn't update.");
  refresh(own.booking.id);
  return ok(res.message);
}

export async function trainerCancelAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), refund: zfd.checkbox(), reason: z.string().trim().max(500).optional() }), formData);
  if (parsed.error) return parsed.error;
  const own = await ownBooking(parsed.data.id);
  if (!own) return fail("Booking not found.");
  const res = await cancelBooking({
    bookingId: own.booking.id,
    actor: { kind: "trainer", userId: own.profile.id },
    trainerRefund: parsed.data.refund,
    reason: parsed.data.reason || undefined,
  });
  if (!res.ok) return fail(res.error);
  refresh(own.booking.id);
  return ok(res.message);
}

export async function saveTrainerNotesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), trainer_notes: z.string().max(5000) }), formData);
  if (parsed.error) return parsed.error;
  const own = await ownBooking(parsed.data.id);
  if (!own) return fail("Booking not found.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ trainer_notes: parsed.data.trainer_notes.trim() || null })
    .eq("id", own.booking.id)
    .eq("trainer_id", own.profile.id);
  if (error) return fail(error.message);
  refresh(own.booking.id);
  return ok("Notes saved.");
}

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time");

export async function trainerRescheduleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ id: z.uuid(), starts_at_local: localDateTime }), formData);
  if (parsed.error) return parsed.error;
  const own = await ownBooking(parsed.data.id);
  if (!own) return fail("Booking not found.");
  const [date, time] = parsed.data.starts_at_local.split("T") as [string, string];
  const startsAt = zonedTimeToUtc(date, timeToMinutes(time), own.profile.timezone).toISOString();
  const res = await rescheduleBooking({
    bookingId: own.booking.id,
    startsAt,
    actor: { kind: "trainer", userId: own.profile.id },
    requireOfferedSlot: false,
  });
  if (!res.ok) return fail(res.error);
  refresh(own.booking.id);
  redirect(`/coach/calendar/${res.booking.id}`);
}

const bookForClientSchema = z.object({
  client_id: z.uuid("Choose a client"),
  session_type_id: z.uuid("Choose a session type"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  weeks: z.coerce.number().int().min(1).max(52),
  payment: z.enum(["pay_later", "credits", "free"]),
  notes: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(32).optional(),
  sms_opt_in: zfd.checkbox(),
});

export async function bookForClientAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(bookForClientSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const supabase = await createClient();
  const [{ data: link }, { data: sessionType }] = await Promise.all([
    supabase.from("trainer_clients").select("client_id").eq("trainer_id", profile.id).eq("client_id", v.client_id).maybeSingle(),
    supabase.from("session_types").select("*").eq("id", v.session_type_id).eq("trainer_id", profile.id).maybeSingle(),
  ]);
  if (!link) return fail("That client isn't on your roster.");
  if (!sessionType || !sessionType.active) return fail("Choose an active session type.");

  const first = zonedTimeToUtc(v.date, timeToMinutes(v.time), profile.timezone);
  if (first.getTime() <= Date.now()) return fail("Pick a time in the future.");
  const result = await bookRecurring({
    sessionType,
    firstStartsAt: first.toISOString(),
    weeks: v.weeks,
    clientId: v.client_id,
    payment: v.payment,
    notes: v.notes || undefined,
    phone: v.phone || undefined,
    smsOptIn: v.sms_opt_in,
    trainerTimezone: profile.timezone,
  });
  revalidatePath("/coach/calendar");
  if (result.booked.length === 0) {
    return fail(result.skipped[0]?.error ?? "Nothing was booked.");
  }
  const skipped = result.skipped.map((s) => `${formatDateTime(s.startsAt, profile.timezone, "MMM d")}: ${s.error}`);
  if (result.booked.length === 1 && skipped.length === 0) redirect(`/coach/calendar/${result.booked[0]!.id}`);
  return ok(
    `Booked ${result.booked.length} session${result.booked.length === 1 ? "" : "s"}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.join("; ")}` : ""}`,
  );
}
