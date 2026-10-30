"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { requireBusiness } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";
import { cancelBooking, rescheduleBooking, type Actor } from "@/lib/scheduling/lifecycle";
import { createBookingCheckout } from "@/lib/payments/checkout";

const token = z.string().regex(/^[a-f0-9]{16,64}$/, "Invalid link");

/**
 * The manage token is the credential (scoped to the business this host
 * serves); the signed-in client (if it's theirs) is recorded as actor.
 */
async function bookingForToken(t: string) {
  const business = await requireBusiness();
  const { data } = await createAdminClient()
    .from("bookings")
    .select("id, client_id")
    .eq("business_id", business.id)
    .eq("manage_token", t)
    .maybeSingle();
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

/** Resume Stripe Checkout for a held, unpaid booking (e.g. after backing out of checkout). */
export async function payByTokenAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ token }), formData);
  if (parsed.error) return parsed.error;
  const business = await requireBusiness();
  const { data: booking } = await createAdminClient()
    .from("bookings")
    .select("id, status, hold_expires_at")
    .eq("business_id", business.id)
    .eq("manage_token", parsed.data.token)
    .maybeSingle();
  if (!booking || booking.status !== "pending_payment") return fail("This booking no longer needs payment.");
  if (!booking.hold_expires_at || new Date(booking.hold_expires_at) <= new Date()) {
    return fail("This hold has expired. Please pick a time again.");
  }
  let url: string;
  try {
    ({ url } = await createBookingCheckout(booking.id));
  } catch (err) {
    console.error("[booking] resume checkout failed", err);
    return fail("We couldn't start checkout. Please try again.");
  }
  redirect(url);
}
