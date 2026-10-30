import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/lib/supabase/database.types";
import type { Business } from "@/lib/tenant";
import { createBookingCheckout } from "@/lib/payments/checkout";
import { captureLead, recordLeadEvent } from "@/lib/leads";
import { readAttribution } from "@/lib/attribution";
import { coachesForType, creditBalance, isSlotOffered, listCoaches, type Coach, type SessionType } from "./availability";
import { onBookingConfirmed, seatsTaken, type Booking } from "./lifecycle";
import { bookingErrorMessage, paymentOptions, type PaymentChoice } from "./policy";
import { orderCoachCandidates } from "./slots";
import { addDays, localDateOf, localTimeOf, timeToMinutes, zonedTimeToUtc } from "./tz";

export const STRIPE_HOLD_MINUTES = 30;

/** RPC errors after which another coach may still be free at that time. */
const TRY_NEXT_COACH = new Set(["slot_conflict", "slot_full", "slot_unavailable", "coach_not_available"]);

export type BookSlotInput = {
  /** The business the booking is for (from the host or the authorized staff context). */
  business: Pick<Business, "id">;
  sessionType: SessionType;
  /** A specific coach, or null for "any available coach". */
  coachId: string | null;
  /** For "any": tried first when free (the client's primary coach). */
  preferredCoachId?: string | null;
  startsAt: string;
  /** Signed-in client booking for themselves (or staff booking for them). */
  clientId: string | null;
  guest?: { name: string; email: string; phone?: string };
  /** Phone for this booking (clients too; stored in guest_phone). */
  phone?: string;
  /** Consent to SMS reminders for this booking (only stored when a phone is given). */
  smsOptIn?: boolean;
  notes?: string;
  clientTimezone?: string;
  payment: PaymentChoice;
  /** "public" = client/guest self-service (slot must be offered); "staff" = booking on someone's behalf. */
  source: "public" | "staff";
  leadId?: string | null;
  recurrenceGroup?: string;
  /** Preloaded coaches of the business (avoids reloading in loops). */
  coaches?: Coach[];
};

export type BookSlotResult =
  | { ok: true; booking: Booking; redirectUrl: string }
  | { ok: false; error: string; code?: string };

async function cancelFailed(bookingId: string, reason: string) {
  await createAdminClient()
    .from("bookings")
    .update({ status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString(), hold_expires_at: null })
    .eq("id", bookingId);
}

/**
 * Reserve a slot via the reserve_booking RPC and settle payment:
 * free / pay later → confirmed; credits → confirmed + consume_credits (rolled
 * back by cancelling on failure); card → pending_payment with a 30 minute hold
 * and a Stripe Checkout redirect. With "any available coach" the free coaches
 * are tried in order (preferred coach first) until one reservation succeeds.
 * `redirectUrl` is in-app (relative) or the Stripe Checkout URL.
 */
export async function bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
  const admin = createAdminClient();
  const st = input.sessionType;
  if (st.business_id !== input.business.id || !st.active) return { ok: false, error: bookingErrorMessage("session_type_not_found") };
  if (!input.clientId && !input.guest?.email) return { ok: false, error: "Please enter your email address." };
  if (Date.parse(input.startsAt) <= Date.now()) return { ok: false, error: "That time has already passed." };

  const coaches = input.coaches ?? (await listCoaches(st.business_id, { bookableOnly: true }));
  const typeCoaches = coachesForType(st, coaches).map((c) => c.id);
  if (input.coachId && !typeCoaches.includes(input.coachId)) {
    return { ok: false, error: "That coach doesn't offer this session. Pick another coach." };
  }
  if (typeCoaches.length === 0) return { ok: false, error: "This session isn't taking bookings right now." };

  // Validate the payment method server-side (never trust the form).
  let method: Enums<"payment_method_kind">;
  let candidates: string[];
  if (input.source === "staff") {
    if (!["pay_later", "credits", "free"].includes(input.payment)) return { ok: false, error: "Choose pay later, credits or free." };
    method = input.payment as Enums<"payment_method_kind">;
    if (method === "credits" && !input.clientId) return { ok: false, error: "Credits need a client account." };
    if (input.coachId) candidates = [input.coachId];
    else {
      // Staff may book outside hours, but coaches whose hours offer this time go first.
      const offer = await isSlotOffered({ businessId: st.business_id, sessionType: st, coaches, coachId: null, startsAt: input.startsAt });
      const prefs = { preferred: input.preferredCoachId, order: st.coach_ids };
      const working = offer.offered ? orderCoachCandidates(offer.coachIds, prefs) : [];
      candidates = [...working, ...orderCoachCandidates(typeCoaches.filter((id) => !working.includes(id)), prefs)];
    }
  } else {
    const balance = input.clientId ? await creditBalance(input.clientId, st.business_id, st.id) : null;
    const allowed = paymentOptions(st, balance);
    if (!allowed.includes(input.payment)) {
      return { ok: false, error: input.payment === "credits" ? bookingErrorMessage("insufficient_credits") : "That payment option isn't available." };
    }
    method = input.payment;

    const offer = await isSlotOffered({ businessId: st.business_id, sessionType: st, coaches, coachId: input.coachId, startsAt: input.startsAt });
    if (!offer.offered) {
      return { ok: false, code: offer.full ? "slot_full" : "slot_unavailable", error: bookingErrorMessage(offer.full ? "slot_full" : "slot_unavailable") };
    }
    candidates = orderCoachCandidates(offer.coachIds, { preferred: input.preferredCoachId, order: st.coach_ids });
  }

  const status: Enums<"booking_status"> = method === "stripe" ? "pending_payment" : "confirmed";
  let booking: Booking | null = null;
  let lastCode: string | undefined;
  for (const coachId of candidates) {
    const { data, error } = await admin.rpc("reserve_booking", {
      p_session_type_id: st.id,
      p_coach_id: coachId,
      p_starts_at: new Date(input.startsAt).toISOString(),
      p_client_id: input.clientId,
      p_guest_name: input.clientId ? null : (input.guest?.name ?? null),
      p_guest_email: input.clientId ? null : (input.guest?.email.toLowerCase() ?? null),
      p_guest_phone: input.phone ?? input.guest?.phone ?? null,
      p_status: status,
      p_payment_method: method,
      p_hold_minutes: STRIPE_HOLD_MINUTES,
      p_client_notes: input.notes ?? null,
      p_lead_id: input.leadId ?? null,
    });
    if (data && !error) {
      booking = data;
      break;
    }
    lastCode = error?.message?.trim();
    if (!lastCode || !TRY_NEXT_COACH.has(lastCode)) break;
  }
  if (!booking) {
    const code = lastCode === "coach_not_available" ? "slot_unavailable" : lastCode;
    return { ok: false, code, error: bookingErrorMessage(code) };
  }

  const extra: { client_timezone?: string; recurrence_group?: string; price_cents?: number; sms_opt_in?: boolean } = {};
  if (input.smsOptIn && (input.phone ?? input.guest?.phone)) extra.sms_opt_in = true;
  if (input.clientTimezone) extra.client_timezone = input.clientTimezone;
  if (input.recurrenceGroup) extra.recurrence_group = input.recurrenceGroup;
  if (method === "free") extra.price_cents = 0;
  if (Object.keys(extra).length) await admin.from("bookings").update(extra).eq("id", booking.id);

  if (method === "credits") {
    const { error: creditError } = await admin.rpc("consume_credits", {
      p_client: input.clientId!,
      p_business: st.business_id,
      p_session_type: st.id,
      p_amount: st.credits_required,
      p_booking: booking.id,
    });
    if (creditError) {
      await cancelFailed(booking.id, "credits_failed");
      return { ok: false, code: creditError.message, error: bookingErrorMessage(creditError.message) };
    }
    await admin.from("bookings").update({ credits_used: st.credits_required }).eq("id", booking.id);
  }

  if (method === "stripe") {
    try {
      const { url } = await createBookingCheckout(booking.id);
      return { ok: true, booking, redirectUrl: url };
    } catch (err) {
      console.error("[scheduling] checkout creation failed", err);
      await cancelFailed(booking.id, "checkout_failed");
      return { ok: false, error: "We couldn't start the payment. Please try again in a moment." };
    }
  }

  try {
    await onBookingConfirmed(booking.id);
  } catch (err) {
    console.error("[scheduling] onBookingConfirmed failed", err);
  }
  return { ok: true, booking, redirectUrl: `/booking/${booking.manage_token}?status=confirmed` };
}

/**
 * Consultation bookings from guests are captured as leads of the business
 * (with first-touch attribution). Returns the lead id or null on failure.
 */
export async function captureConsultLead(input: {
  businessId: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<string | null> {
  try {
    const [firstName, ...rest] = input.name.trim().split(/\s+/);
    const lead = await captureLead({
      businessId: input.businessId,
      email: input.email,
      firstName,
      lastName: rest.join(" ") || undefined,
      phone: input.phone,
      source: "booking",
      attribution: await readAttribution(),
    });
    return lead.id;
  } catch (err) {
    console.error("[scheduling] lead capture failed", err);
    return null;
  }
}

/**
 * Once a consult booking exists: the lead gets the booking's coach (unless
 * already assigned) and a consult_booked event (which also moves its status).
 */
export async function markConsultBooked(leadId: string, booking: Booking) {
  await createAdminClient()
    .from("leads")
    .update({ assigned_coach_id: booking.coach_id })
    .eq("id", leadId)
    .eq("business_id", booking.business_id)
    .is("assigned_coach_id", null);
  try {
    await recordLeadEvent({
      businessId: booking.business_id,
      leadId,
      type: "consult_booked",
      detail: { booking_id: booking.id, starts_at: booking.starts_at, coach_id: booking.coach_id },
    });
  } catch (err) {
    console.error("[scheduling] lead event failed", err);
  }
}

/**
 * Add someone to the waitlist for a full group session (idempotent per
 * email). With "any coach", the person waits for the first coach's class.
 */
export async function joinWaitlist(input: {
  sessionType: SessionType;
  coachId: string | null;
  startsAt: string;
  email: string;
  name?: string;
  clientId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const st = input.sessionType;
  if (st.capacity <= 1) return { ok: false, error: "Waitlists are only available for group sessions." };
  if (Date.parse(input.startsAt) <= Date.now()) return { ok: false, error: "That session has already started." };
  const coaches = await listCoaches(st.business_id, { bookableOnly: true });
  const offer = await isSlotOffered({ businessId: st.business_id, sessionType: st, coaches, coachId: input.coachId, startsAt: input.startsAt });
  if (offer.offered) return { ok: false, error: "Good news: there's a spot available. Book it now instead." };
  const coachId = offer.full ? offer.coachIds[0] : undefined;
  if (!coachId) return { ok: false, error: "That session isn't available." };
  if ((await seatsTaken(st.id, coachId, input.startsAt)) < st.capacity) {
    return { ok: false, error: "Good news: there's a spot available. Book it now instead." };
  }
  const { error } = await createAdminClient().from("waitlist_entries").upsert(
    {
      business_id: st.business_id,
      session_type_id: st.id,
      coach_id: coachId,
      starts_at: new Date(input.startsAt).toISOString(),
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      client_id: input.clientId,
    },
    { onConflict: "session_type_id,coach_id,starts_at,email", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: "Couldn't join the waitlist. Please try again." };
  return { ok: true };
}

export type RecurringResult = { booked: Booking[]; skipped: { startsAt: string; error: string }[] };

/**
 * Staff book a client into a session, optionally repeating weekly at the
 * same local wall-clock time (DST-safe, in `timezone`) for N weeks, sharing a
 * recurrence_group. With "any coach" each week is assigned separately
 * (preferring the client's primary coach).
 */
export async function bookRecurring(input: {
  business: Pick<Business, "id">;
  sessionType: SessionType;
  coachId: string | null;
  preferredCoachId?: string | null;
  firstStartsAt: string;
  weeks: number;
  clientId: string;
  payment: "pay_later" | "credits" | "free";
  notes?: string;
  phone?: string;
  smsOptIn?: boolean;
  timezone: string;
}): Promise<RecurringResult> {
  const weeks = Math.max(1, Math.min(52, input.weeks));
  const group = weeks > 1 ? randomUUID() : undefined;
  const firstDate = localDateOf(input.firstStartsAt, input.timezone);
  const minutes = timeToMinutes(localTimeOf(input.firstStartsAt, input.timezone));
  const coaches = await listCoaches(input.sessionType.business_id, { bookableOnly: true });
  const result: RecurringResult = { booked: [], skipped: [] };
  for (let i = 0; i < weeks; i++) {
    const startsAt = zonedTimeToUtc(addDays(firstDate, i * 7), minutes, input.timezone).toISOString();
    const res = await bookSlot({
      business: input.business,
      sessionType: input.sessionType,
      coachId: input.coachId,
      preferredCoachId: input.preferredCoachId,
      startsAt,
      clientId: input.clientId,
      notes: input.notes,
      phone: input.phone,
      smsOptIn: input.smsOptIn,
      payment: input.payment,
      source: "staff",
      recurrenceGroup: group,
      coaches,
    });
    if (res.ok) result.booked.push(res.booking);
    else result.skipped.push({ startsAt, error: res.error });
  }
  return result;
}
