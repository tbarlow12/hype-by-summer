// Pure mapping helpers between Stripe objects and our tables. No I/O here so
// everything is unit-testable (see mapping.test.ts).
import type Stripe from "stripe";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Database } from "@/lib/supabase/database.types";

type PaymentStatus = Database["public"]["Enums"]["payment_status"];
type BillingInterval = Database["public"]["Enums"]["billing_interval"];

export type CheckoutKind = "booking" | "package" | "subscription" | "one_time";
const CHECKOUT_KINDS: CheckoutKind[] = ["booking", "package", "subscription", "one_time"];

/** Stripe's limits for Checkout Session expiry. */
export const CHECKOUT_MIN_EXPIRY_SECONDS = 30 * 60;
export const CHECKOUT_MAX_EXPIRY_SECONDS = 24 * 60 * 60;

export const toIso = (epochSeconds: number | null | undefined): string | null =>
  epochSeconds ? new Date(epochSeconds * 1000).toISOString() : null;

export const idOf = (v: string | { id: string } | null | undefined): string | null =>
  v == null ? null : typeof v === "string" ? v : v.id;

/**
 * Checkout `expires_at` (unix seconds) for a booking hold. Matches the hold
 * when possible, but Stripe requires 30 min..24 h from now, so short holds are
 * extended (the caller then pushes the booking hold out to match).
 */
export function checkoutExpiresAt(holdExpiresAt: Date | string | null, now: Date = new Date()): number {
  const nowS = Math.floor(now.getTime() / 1000);
  // A minute of slack so the request never races Stripe's 30-minute minimum.
  const min = nowS + CHECKOUT_MIN_EXPIRY_SECONDS + 60;
  const max = nowS + CHECKOUT_MAX_EXPIRY_SECONDS - 60;
  const hold = holdExpiresAt ? Math.floor(new Date(holdExpiresAt).getTime() / 1000) : min;
  return Math.min(max, Math.max(min, hold));
}

export function checkoutKind(session: Pick<Stripe.Checkout.Session, "metadata" | "mode">): CheckoutKind | null {
  const kind = session.metadata?.kind;
  if (kind && (CHECKOUT_KINDS as string[]).includes(kind)) return kind as CheckoutKind;
  return null;
}

export type CreditGrant = {
  delta: number;
  expires_at: string | null;
  session_type_ids: string[] | null;
};

/** Credits to grant for one package purchase / subscription period. */
export function creditGrantFor(
  offering: { credits: number; credits_expire_days: number | null; session_type_ids: string[] | null },
  grantedAt: Date,
  opts: { periodEnd?: Date | null } = {},
): CreditGrant | null {
  if (!offering.credits || offering.credits <= 0) return null;
  let expires: Date | null = null;
  if (offering.credits_expire_days && offering.credits_expire_days > 0) {
    expires = new Date(grantedAt.getTime() + offering.credits_expire_days * 86_400_000);
  }
  // Subscription allotments without an explicit expiry roll off at period end
  // (plus a grace day so a session booked on the last day still counts).
  if (!expires && opts.periodEnd) expires = new Date(opts.periodEnd.getTime() + 86_400_000);
  return {
    delta: offering.credits,
    expires_at: expires ? expires.toISOString() : null,
    session_type_ids: offering.session_type_ids && offering.session_type_ids.length ? offering.session_type_ids : null,
  };
}

/** Status for a payment given its amount and what has been refunded. */
export function refundStatus(amountCents: number, refundedCents: number): PaymentStatus {
  if (refundedCents <= 0) return "succeeded";
  return refundedCents >= amountCents ? "refunded" : "partially_refunded";
}

export function refundableCents(p: { amount_cents: number; amount_refunded_cents: number; status: PaymentStatus }): number {
  if (p.status !== "succeeded" && p.status !== "partially_refunded") return 0;
  return Math.max(0, p.amount_cents - p.amount_refunded_cents);
}

/** charge.refunded → payments update. */
export function paymentUpdateFromCharge(charge: Pick<Stripe.Charge, "id" | "amount" | "amount_refunded" | "receipt_url">) {
  return {
    stripe_charge_id: charge.id,
    amount_refunded_cents: charge.amount_refunded,
    status: refundStatus(charge.amount, charge.amount_refunded),
    ...(charge.receipt_url ? { receipt_url: charge.receipt_url } : {}),
  };
}

/** checkout.session.completed / async_payment_* → payments update. */
export function paymentUpdateFromCheckout(
  session: Pick<Stripe.Checkout.Session, "payment_status" | "amount_total" | "payment_intent" | "currency" | "customer_details">,
  outcome: "completed" | "async_succeeded" | "async_failed" | "expired",
  now: Date = new Date(),
) {
  const base = {
    stripe_payment_intent_id: idOf(session.payment_intent),
    ...(session.amount_total != null ? { amount_cents: session.amount_total } : {}),
    ...(session.currency ? { currency: session.currency } : {}),
    ...(session.customer_details?.email ? { payer_email: session.customer_details.email } : {}),
  };
  switch (outcome) {
    case "expired":
      return { status: "cancelled" as PaymentStatus };
    case "async_failed":
      return { ...base, status: "failed" as PaymentStatus };
    case "async_succeeded":
      return { ...base, status: "succeeded" as PaymentStatus, paid_at: now.toISOString() };
    case "completed": {
      const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      return paid
        ? { ...base, status: "succeeded" as PaymentStatus, paid_at: now.toISOString() }
        : { ...base, status: "pending" as PaymentStatus };
    }
  }
}

/** Subscription id an invoice belongs to (new API: invoice.parent.subscription_details). */
export function invoiceSubscriptionId(invoice: Pick<Stripe.Invoice, "parent">): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription ?? null);
}

/** PaymentIntent that paid an invoice (new API: invoice.payments). */
export function invoicePaymentIntentId(invoice: Pick<Stripe.Invoice, "payments">): string | null {
  const payments = invoice.payments?.data ?? [];
  const best =
    payments.find((p) => p.status === "paid" && p.payment.payment_intent) ??
    payments.find((p) => p.is_default && p.payment.payment_intent) ??
    payments.find((p) => p.payment.payment_intent);
  return idOf(best?.payment.payment_intent ?? null);
}

/** invoice.paid / invoice.payment_failed → payments row fields. */
export function paymentFromInvoice(
  invoice: Pick<Stripe.Invoice, "id" | "amount_paid" | "amount_due" | "currency" | "hosted_invoice_url" | "invoice_pdf" | "number" | "customer_email" | "status_transitions" | "payments" | "billing_reason">,
  outcome: "paid" | "failed",
) {
  const paidAt = toIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString();
  return {
    stripe_invoice_id: invoice.id,
    stripe_payment_intent_id: invoicePaymentIntentId(invoice),
    amount_cents: outcome === "paid" ? invoice.amount_paid : invoice.amount_due,
    currency: invoice.currency,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    payer_email: invoice.customer_email ?? null,
    status: (outcome === "paid" ? "succeeded" : "failed") as PaymentStatus,
    paid_at: outcome === "paid" ? paidAt : null,
    metadata: {
      invoice_number: invoice.number,
      invoice_pdf: invoice.invoice_pdf ?? null,
      billing_reason: invoice.billing_reason,
    },
  };
}

/** customer.subscription.* → subscriptions row fields. Periods live on items. */
export function subscriptionRowFromStripe(sub: Pick<Stripe.Subscription, "status" | "items" | "cancel_at_period_end" | "cancel_at" | "canceled_at" | "trial_end">) {
  const items = sub.items?.data ?? [];
  const starts = items.map((i) => i.current_period_start).filter(Boolean);
  const ends = items.map((i) => i.current_period_end).filter(Boolean);
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  return {
    status: sub.status,
    stripe_price_id: items[0]?.price?.id ?? null,
    current_period_start: starts.length ? toIso(Math.min(...starts)) : null,
    current_period_end: ends.length ? toIso(Math.max(...ends)) : null,
    // The portal may schedule a cancel via cancel_at instead of the flag.
    cancel_at_period_end: !ended && (sub.cancel_at_period_end || sub.cancel_at != null),
    canceled_at: toIso(sub.canceled_at),
    trial_end: toIso(sub.trial_end),
  };
}

/** Should an invoice grant a period of subscription credits? */
export function invoiceGrantsCredits(invoice: Pick<Stripe.Invoice, "billing_reason" | "amount_paid">): boolean {
  // Period starts (first invoice incl. $0 trial invoices, and renewals). Mid-
  // cycle proration / manual invoices don't grant another allotment.
  return invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle";
}

export const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/** Normalise a recurring price to a monthly amount (cents). */
export function monthlyRecurringCents(priceCents: number, interval: BillingInterval | null, intervalCount = 1): number {
  if (!interval) return 0;
  const count = Math.max(1, intervalCount);
  const perMonth = { week: 52 / 12, month: 1, year: 1 / 12 }[interval];
  return Math.round((priceCents * perMonth) / count);
}

export type RevenueRow = { paid_at: string | null; amount_cents: number; amount_refunded_cents: number; status: PaymentStatus };

/** Net revenue counted for a payment (refunds subtracted). */
export function netRevenueCents(p: Pick<RevenueRow, "amount_cents" | "amount_refunded_cents" | "status">): number {
  if (p.status !== "succeeded" && p.status !== "partially_refunded" && p.status !== "refunded") return 0;
  return Math.max(0, p.amount_cents - p.amount_refunded_cents);
}

/** Month keys (yyyy-MM in `tz`), oldest first, ending with the current month. */
export function lastMonths(now: Date, tz: string, months: number): string[] {
  const [y, m] = formatInTimeZone(now, tz, "yyyy-MM").split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** UTC instant of the first moment of a yyyy-MM month in `tz`. */
export function monthStartUtc(monthKey: string, tz: string): Date {
  return fromZonedTime(`${monthKey}-01T00:00:00`, tz);
}

/** Bucket net revenue by month in the trainer's timezone. */
export function revenueByMonth(rows: RevenueRow[], tz: string, now: Date, months = 12): { month: string; cents: number }[] {
  const keys = lastMonths(now, tz, months);
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    if (!r.paid_at) continue;
    const key = formatInTimeZone(r.paid_at, tz, "yyyy-MM");
    if (totals.has(key)) totals.set(key, totals.get(key)! + netRevenueCents(r));
  }
  return keys.map((month) => ({ month, cents: totals.get(month)! }));
}

/** Late-cancel / no-show fee configured for a trainer. */
export function bookingFeeCents(
  policy: { late_cancel_fee_cents: number; no_show_fee_cents: number },
  kind: "late_cancel" | "no_show",
): number {
  return kind === "late_cancel" ? policy.late_cancel_fee_cents : policy.no_show_fee_cents;
}

/** Card errors that mean "ask the customer to act" rather than a bug on our side. */
export function feeFailureMessage(err: { code?: string; decline_code?: string; message?: string }): string {
  switch (err.code) {
    case "authentication_required":
      return "The card needs the client to authenticate the payment.";
    case "card_declined":
      return err.decline_code === "insufficient_funds"
        ? "The card was declined for insufficient funds."
        : "The card was declined.";
    case "expired_card":
      return "The saved card has expired.";
    case "incorrect_cvc":
    case "processing_error":
      return "The card could not be processed.";
    default:
      return err.message ?? "The card could not be charged.";
  }
}
