import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/lib/supabase/database.types";
import { createBookingCheckout } from "@/lib/payments/checkout";
import { captureLead, recordLeadEvent } from "@/lib/leads";
import { readAttribution } from "@/lib/attribution";
import { absoluteUrl } from "@/lib/env";
import { creditBalance, getTrainerSchedulingInfo, isSlotOffered, type SessionType } from "./availability";
import { onBookingConfirmed, seatsTaken, type Booking } from "./lifecycle";
import { bookingErrorMessage, paymentOptions, type PaymentChoice } from "./policy";
import { addDays, localDateOf, localTimeOf, timeToMinutes, zonedTimeToUtc } from "./tz";

export const STRIPE_HOLD_MINUTES = 30;

export type BookSlotInput = {
  sessionType: SessionType;
  startsAt: string;
  /** Signed-in client booking for themselves (or a trainer booking for them). */
  clientId: string | null;
  guest?: { name: string; email: string; phone?: string };
  /** Phone for this booking (clients too; stored in guest_phone). */
  phone?: string;
  /** Consent to SMS reminders for this booking (only stored when a phone is given). */
  smsOptIn?: boolean;
  notes?: string;
  clientTimezone?: string;
  payment: PaymentChoice;
  /** "public" = client/guest self-service (slot must be offered); "trainer" = coach booking on someone's behalf. */
  source: "public" | "trainer";
  leadId?: string | null;
  recurrenceGroup?: string;
};

export type BookSlotResult =
  | { ok: true; booking: Booking; redirectUrl: string }
  | { ok: false; error: string; code?: string };

async function cancelFailed(bookingId: string, reason: string) {
  const admin = createAdminClient();
  await admin
    .from("bookings")
    .update({ status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString(), hold_expires_at: null })
    .eq("id", bookingId);
}

/**
 * Reserve a slot via the reserve_booking RPC and settle payment:
 * free / pay later → confirmed; credits → confirmed + consume_credits (rolled
 * back by cancelling on failure); card → pending_payment with a 30 minute hold
 * and a Stripe Checkout redirect.
 */
export async function bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
  const admin = createAdminClient();
  const st = input.sessionType;
  if (!st.active) return { ok: false, error: bookingErrorMessage("session_type_not_found") };
  if (!input.clientId && !input.guest?.email) return { ok: false, error: "Please enter your email address." };
  if (Date.parse(input.startsAt) <= Date.now()) return { ok: false, error: "That time has already passed." };

  const trainer = await getTrainerSchedulingInfo(st.trainer_id);
  if (!trainer) return { ok: false, error: "This coach isn't taking bookings right now." };

  // Validate the payment method server-side (never trust the form).
  let method: Enums<"payment_method_kind">;
  if (input.source === "trainer") {
    if (!["pay_later", "credits", "free"].includes(input.payment)) return { ok: false, error: "Choose pay later, credits or free." };
    method = input.payment as Enums<"payment_method_kind">;
    if (method === "credits" && !input.clientId) return { ok: false, error: "Credits need a client account." };
  } else {
    const balance = input.clientId ? await creditBalance(input.clientId, st.trainer_id, st.id) : null;
    const allowed = paymentOptions(st, balance);
    if (!allowed.includes(input.payment)) {
      return { ok: false, error: input.payment === "credits" ? bookingErrorMessage("insufficient_credits") : "That payment option isn't available." };
    }
    method = input.payment;

    const offer = await isSlotOffered({ trainerId: st.trainer_id, timezone: trainer.timezone, sessionType: st, startsAt: input.startsAt });
    if (!offer.offered) {
      return { ok: false, code: offer.full ? "slot_full" : "slot_unavailable", error: bookingErrorMessage(offer.full ? "slot_full" : "slot_unavailable") };
    }
  }

  const status: Enums<"booking_status"> = method === "stripe" ? "pending_payment" : "confirmed";
  const { data: booking, error } = await admin.rpc("reserve_booking", {
    p_session_type_id: st.id,
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
  if (error || !booking) {
    const code = error?.message?.trim();
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
      p_trainer: st.trainer_id,
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
  return { ok: true, booking, redirectUrl: absoluteUrl(`/booking/${booking.manage_token}?status=confirmed`) };
}

/**
 * Consultation bookings from guests are captured as leads (with first-touch
 * attribution). Returns the lead id or null if capture failed.
 */
export async function captureConsultLead(input: {
  trainerId: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<string | null> {
  try {
    const [firstName, ...rest] = input.name.trim().split(/\s+/);
    const lead = await captureLead({
      trainerId: input.trainerId,
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

/** Marks a lead's consult as booked (event + status) once the booking exists. */
export async function markConsultBooked(leadId: string, booking: Booking) {
  try {
    await recordLeadEvent(leadId, "consult_booked", { booking_id: booking.id, starts_at: booking.starts_at });
  } catch (err) {
    console.error("[scheduling] lead event failed", err);
  }
  const admin = createAdminClient();
  await admin.from("leads").update({ status: "consult_booked" }).eq("id", leadId).in("status", ["new", "contacted", "nurturing"]);
}

/** Add someone to the waitlist for a full group session (idempotent per email). */
export async function joinWaitlist(input: {
  sessionType: SessionType;
  startsAt: string;
  email: string;
  name?: string;
  clientId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const st = input.sessionType;
  if (st.capacity <= 1) return { ok: false, error: "Waitlists are only available for group sessions." };
  if (Date.parse(input.startsAt) <= Date.now()) return { ok: false, error: "That session has already started." };
  const taken = await seatsTaken(st.id, input.startsAt);
  if (taken < st.capacity) return { ok: false, error: "Good news: there's a spot available. Book it now instead." };
  const admin = createAdminClient();
  const { error } = await admin.from("waitlist_entries").upsert(
    {
      session_type_id: st.id,
      starts_at: new Date(input.startsAt).toISOString(),
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      client_id: input.clientId,
    },
    { onConflict: "session_type_id,starts_at,email", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: "Couldn't join the waitlist. Please try again." };
  return { ok: true };
}

export type RecurringResult = { booked: Booking[]; skipped: { startsAt: string; error: string }[] };

/**
 * Trainer books a client into a session, optionally repeating weekly at the
 * same local wall-clock time (DST-safe) for N weeks, sharing a recurrence_group.
 */
export async function bookRecurring(input: {
  sessionType: SessionType;
  firstStartsAt: string;
  weeks: number;
  clientId: string;
  payment: "pay_later" | "credits" | "free";
  notes?: string;
  phone?: string;
  smsOptIn?: boolean;
  trainerTimezone: string;
}): Promise<RecurringResult> {
  const weeks = Math.max(1, Math.min(52, input.weeks));
  const group = weeks > 1 ? randomUUID() : undefined;
  const firstDate = localDateOf(input.firstStartsAt, input.trainerTimezone);
  const minutes = timeToMinutes(localTimeOf(input.firstStartsAt, input.trainerTimezone));
  const result: RecurringResult = { booked: [], skipped: [] };
  for (let i = 0; i < weeks; i++) {
    const startsAt = zonedTimeToUtc(addDays(firstDate, i * 7), minutes, input.trainerTimezone).toISOString();
    const res = await bookSlot({
      sessionType: input.sessionType,
      startsAt,
      clientId: input.clientId,
      notes: input.notes,
      phone: input.phone,
      smsOptIn: input.smsOptIn,
      payment: input.payment,
      source: "trainer",
      recurrenceGroup: group,
    });
    if (res.ok) result.booked.push(res.booking);
    else result.skipped.push({ startsAt, error: res.error });
  }
  return result;
}
