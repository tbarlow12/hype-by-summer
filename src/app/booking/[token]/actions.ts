"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";
import { cancelBooking, rescheduleBooking, type Actor } from "@/lib/scheduling/lifecycle";

const token = z.string().regex(/^[a-f0-9]{16,64}$/, "Invalid link");

/** The manage token is the credential; the signed-in client (if it's theirs) is recorded as actor. */
async function bookingForToken(t: string) {
  const { data } = await createAdminClient().from("bookings").select("id, client_id").eq("manage_token", t).maybeSingle();
  if (!data) return null;
  const profile = await getProfile();
  const actor: Actor =
    profile && data.client_id === profile.id ? { kind: "client", userId: profile.id } : { kind: "guest", userId: null };
  return { id: data.id, actor };
}

export async function cancelByTokenAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ token, reason: z.string().trim().max(500).optional() }), formData);
  if (parsed.error) return parsed.error;
  const booking = await bookingForToken(parsed.data.token);
  if (!booking) return fail("Booking not found.");
  const res = await cancelBooking({ bookingId: booking.id, actor: booking.actor, reason: parsed.data.reason || undefined });
  if (!res.ok) return fail(res.error);
  revalidatePath(`/booking/${parsed.data.token}`);
  revalidatePath("/me/bookings");
  return ok(res.message);
}

export async function rescheduleByTokenAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ token, starts_at: z.string().refine((v) => !Number.isNaN(Date.parse(v))) }), formData);
  if (parsed.error) return parsed.error;
  const booking = await bookingForToken(parsed.data.token);
  if (!booking) return fail("Booking not found.");
  const res = await rescheduleBooking({ bookingId: booking.id, startsAt: parsed.data.starts_at, actor: booking.actor, requireOfferedSlot: true });
  if (!res.ok) return fail(res.error);
  revalidatePath("/me/bookings");
  redirect(`/booking/${res.booking.manage_token}?status=rescheduled`);
}
