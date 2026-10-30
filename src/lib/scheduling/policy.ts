// Pure booking policy rules: cancellation / reschedule decisions, RPC error
// messages and reminder scheduling. Shared by server code and UI copy.

import type { Database } from "@/lib/supabase/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];
type PaymentMethod = Database["public"]["Enums"]["payment_method_kind"];

export type CancellationPolicy = {
  cancellation_window_hours: number;
  late_cancel_fee_cents: number;
  no_show_fee_cents: number;
  refund_on_cancel: boolean;
};

export type PolicyBooking = {
  status: BookingStatus;
  starts_at: string;
  payment_method: PaymentMethod;
  credits_used: number;
  is_consultation?: boolean;
};

export type CancelDecision =
  | { allowed: false; reason: string }
  | {
      allowed: true;
      late: boolean;
      status: "cancelled" | "late_cancelled";
      refundPayment: boolean;
      refundCredits: boolean;
      chargeFee: boolean;
      feeCents: number;
      summary: string;
    };

const HOUR = 3_600_000;

export const ACTIVE_STATUSES: BookingStatus[] = ["confirmed", "pending_payment"];

export function hoursUntil(startsAt: string, now: Date): number {
  return (Date.parse(startsAt) - now.getTime()) / HOUR;
}

export function isLateCancel(startsAt: string, policy: Pick<CancellationPolicy, "cancellation_window_hours">, now: Date): boolean {
  return hoursUntil(startsAt, now) < policy.cancellation_window_hours;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Decide what cancelling means. Clients inside the window get a late cancel
 * (no refund, credits forfeited, fee for sessions not already paid for).
 * Outside the window credits always come back and card payments are refunded
 * when the business policy allows. Staff choose whether to refund.
 */
export function decideCancellation(input: {
  booking: PolicyBooking;
  policy: CancellationPolicy;
  now: Date;
  actor: "client" | "coach";
  coachRefund?: boolean;
}): CancelDecision {
  const { booking, policy, now, actor } = input;
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return { allowed: false, reason: "This session is no longer active." };
  }
  if (Date.parse(booking.starts_at) <= now.getTime()) {
    return { allowed: false, reason: "This session has already started." };
  }
  const usedCredits = booking.payment_method === "credits" || booking.credits_used > 0;
  if (booking.status === "pending_payment") {
    return {
      allowed: true, late: false, status: "cancelled", refundPayment: false, refundCredits: false,
      chargeFee: false, feeCents: 0, summary: "Your unpaid reservation will be released.",
    };
  }
  if (actor === "coach") {
    const refund = input.coachRefund ?? true;
    return {
      allowed: true,
      late: false,
      status: "cancelled",
      refundPayment: refund && booking.payment_method === "stripe",
      refundCredits: refund && usedCredits,
      chargeFee: false,
      feeCents: 0,
      summary: refund ? "The client will be refunded in full." : "No refund will be issued.",
    };
  }
  const late = isLateCancel(booking.starts_at, policy, now);
  if (!late) {
    const refundPayment = policy.refund_on_cancel && booking.payment_method === "stripe";
    const parts = ["You're cancelling outside the cancellation window."];
    if (usedCredits) parts.push("Your session credit will be returned.");
    if (booking.payment_method === "stripe") {
      parts.push(refundPayment ? "Your payment will be refunded in full." : "Payments are non-refundable under this cancellation policy.");
    }
    return { allowed: true, late: false, status: "cancelled", refundPayment, refundCredits: usedCredits, chargeFee: false, feeCents: 0, summary: parts.join(" ") };
  }
  const prepaid = booking.payment_method === "stripe" || usedCredits;
  const chargeFee = policy.late_cancel_fee_cents > 0 && !prepaid && !booking.is_consultation;
  const parts = [`This is within ${policy.cancellation_window_hours} hours of the session, so it counts as a late cancellation.`];
  if (booking.payment_method === "stripe") parts.push("Your payment is non-refundable.");
  if (usedCredits) parts.push("The session credit will not be returned.");
  if (chargeFee) parts.push(`A late cancellation fee of ${money(policy.late_cancel_fee_cents)} will be charged to your card on file.`);
  return {
    allowed: true, late: true, status: "late_cancelled", refundPayment: false, refundCredits: false,
    chargeFee, feeCents: chargeFee ? policy.late_cancel_fee_cents : 0, summary: parts.join(" "),
  };
}

/** Clients may reschedule confirmed sessions outside the cancellation window; staff any time before start. */
export function canReschedule(input: {
  booking: Pick<PolicyBooking, "status" | "starts_at">;
  policy: Pick<CancellationPolicy, "cancellation_window_hours">;
  now: Date;
  actor: "client" | "coach";
}): { allowed: true } | { allowed: false; reason: string } {
  const { booking, policy, now, actor } = input;
  if (booking.status !== "confirmed") return { allowed: false, reason: "Only confirmed sessions can be rescheduled." };
  if (Date.parse(booking.starts_at) <= now.getTime()) return { allowed: false, reason: "This session has already started." };
  if (actor === "client" && isLateCancel(booking.starts_at, policy, now)) {
    return {
      allowed: false,
      reason: `Sessions can be rescheduled online up to ${policy.cancellation_window_hours} hours before they start. Please message your coach.`,
    };
  }
  return { allowed: true };
}

/** Plain-language policy shown before booking / cancelling. */
export function describePolicy(policy: CancellationPolicy): string {
  const parts: string[] = [];
  if (policy.cancellation_window_hours > 0) {
    parts.push(`Free cancellation or rescheduling up to ${policy.cancellation_window_hours} hours before your session.`);
    parts.push(
      policy.late_cancel_fee_cents > 0
        ? `Later cancellations are non-refundable and unpaid sessions incur a ${money(policy.late_cancel_fee_cents)} fee.`
        : "Later cancellations are non-refundable.",
    );
  } else {
    parts.push("You can cancel or reschedule any time before your session.");
  }
  if (!policy.refund_on_cancel) parts.push("Card payments are not refunded on cancellation; session credits are returned.");
  if (policy.no_show_fee_cents > 0) parts.push(`Missed sessions may incur a ${money(policy.no_show_fee_cents)} no-show fee.`);
  return parts.join(" ");
}

const RPC_ERRORS: Record<string, string> = {
  slot_full: "Sorry, that class just filled up. Pick another time or join the waitlist.",
  slot_conflict: "Sorry, that time was just taken. Please pick another time.",
  slot_unavailable: "That time is no longer available. Please pick another time.",
  already_booked: "You're already booked into this session.",
  session_type_not_found: "This session type is no longer available.",
  insufficient_credits: "You don't have enough session credits for this booking.",
  not_reschedulable: "Only confirmed sessions can be rescheduled.",
  same_time: "Pick a different time to reschedule to.",
  booking_not_found: "We couldn't find that booking.",
  coach_not_available: "That coach isn't available for this session. Pick another coach.",
};

/** Maps a Postgres error message from the booking RPCs to a friendly sentence. */
export function bookingErrorMessage(message: string | null | undefined): string {
  const code = (message ?? "").trim();
  return RPC_ERRORS[code] ?? "Something went wrong while booking. Please try again.";
}

export function isKnownBookingError(message: string | null | undefined): boolean {
  return Boolean(message && RPC_ERRORS[message.trim()]);
}

/**
 * Which reminder (if any) to send now. A reminder is due once we pass
 * `starts_at - hours`. If several are due at once only the closest one is
 * sent; reminders whose moment passed before the booking existed are marked
 * done without sending (the confirmation covered them).
 */
export function dueReminder(input: {
  starts_at: string;
  created_at: string;
  reminders_sent: number[];
  reminderHours: number[];
  now: Date;
}): { send: number | null; mark: number[] } {
  const start = Date.parse(input.starts_at);
  const created = Date.parse(input.created_at);
  const now = input.now.getTime();
  if (start <= now) return { send: null, mark: [] };
  const pending = [...new Set(input.reminderHours)]
    .filter((h) => h > 0 && !input.reminders_sent.includes(h))
    .filter((h) => now >= start - h * HOUR);
  if (pending.length === 0) return { send: null, mark: [] };
  const sendable = pending.filter((h) => created < start - h * HOUR);
  const send = sendable.length ? Math.min(...sendable) : null;
  return { send, mark: pending.sort((a, b) => b - a) };
}

export type PaymentChoice = "stripe" | "credits" | "pay_later" | "free";

export type PaymentSessionType = {
  price_cents: number;
  requires_payment: boolean;
  is_consultation: boolean;
  allow_credits: boolean;
  credits_required: number;
};

/**
 * How a client may pay for a session type. Consultations and free sessions
 * need no payment. Credits are offered when the client holds enough; card
 * checkout when the type requires payment, otherwise "pay later".
 */
export function paymentOptions(st: PaymentSessionType, creditBalance: number | null): PaymentChoice[] {
  if (st.is_consultation || st.price_cents === 0) return ["free"];
  const options: PaymentChoice[] = [];
  if (st.allow_credits && st.credits_required > 0 && creditBalance !== null && creditBalance >= st.credits_required) {
    options.push("credits");
  }
  options.push(st.requires_payment ? "stripe" : "pay_later");
  return options;
}

export const PAYMENT_LABELS: Record<PaymentChoice, string> = {
  stripe: "Pay now by card",
  credits: "Use session credits",
  pay_later: "Pay at the session",
  free: "Free",
};
