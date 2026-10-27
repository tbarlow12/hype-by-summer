import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  bookingFeeCents,
  checkoutExpiresAt,
  checkoutKind,
  creditGrantFor,
  feeFailureMessage,
  invoiceGrantsCredits,
  invoicePaymentIntentId,
  invoiceSubscriptionId,
  lastMonths,
  monthlyRecurringCents,
  netRevenueCents,
  paymentFromInvoice,
  paymentUpdateFromCharge,
  paymentUpdateFromCheckout,
  refundStatus,
  refundableCents,
  revenueByMonth,
  subscriptionRowFromStripe,
} from "./mapping";

const now = new Date("2026-10-27T12:00:00Z");
const nowS = Math.floor(now.getTime() / 1000);

describe("checkoutExpiresAt", () => {
  it("extends short holds to Stripe's 30 minute minimum", () => {
    const hold = new Date(now.getTime() + 15 * 60_000);
    expect(checkoutExpiresAt(hold, now)).toBe(nowS + 31 * 60);
  });
  it("matches longer holds", () => {
    const hold = new Date(now.getTime() + 2 * 3600_000);
    expect(checkoutExpiresAt(hold.toISOString(), now)).toBe(nowS + 7200);
  });
  it("caps at 24 hours", () => {
    const hold = new Date(now.getTime() + 3 * 86_400_000);
    expect(checkoutExpiresAt(hold, now)).toBe(nowS + 86_400 - 60);
  });
  it("defaults when there is no hold", () => {
    expect(checkoutExpiresAt(null, now)).toBe(nowS + 31 * 60);
  });
});

describe("checkoutKind", () => {
  it("reads metadata.kind", () => {
    expect(checkoutKind({ metadata: { kind: "package" }, mode: "payment" })).toBe("package");
    expect(checkoutKind({ metadata: { kind: "booking" }, mode: "payment" })).toBe("booking");
  });
  it("ignores unknown sessions", () => {
    expect(checkoutKind({ metadata: {}, mode: "payment" })).toBeNull();
    expect(checkoutKind({ metadata: { kind: "other" }, mode: "payment" })).toBeNull();
    expect(checkoutKind({ metadata: null, mode: "payment" })).toBeNull();
  });
});

describe("creditGrantFor", () => {
  const base = { credits: 10, credits_expire_days: 90, session_type_ids: ["st-1"] };
  it("grants credits with expiry and restrictions", () => {
    expect(creditGrantFor(base, now)).toEqual({
      delta: 10,
      expires_at: "2027-01-25T12:00:00.000Z",
      session_type_ids: ["st-1"],
    });
  });
  it("treats empty session types as any", () => {
    expect(creditGrantFor({ ...base, session_type_ids: [] }, now)?.session_type_ids).toBeNull();
    expect(creditGrantFor({ ...base, session_type_ids: null }, now)?.session_type_ids).toBeNull();
  });
  it("no expiry without credits_expire_days", () => {
    expect(creditGrantFor({ ...base, credits_expire_days: null }, now)?.expires_at).toBeNull();
  });
  it("subscription allotments roll off a day after period end when no expiry is set", () => {
    const periodEnd = new Date("2026-11-27T12:00:00Z");
    expect(creditGrantFor({ ...base, credits_expire_days: null }, now, { periodEnd })?.expires_at).toBe(
      "2026-11-28T12:00:00.000Z",
    );
    // An explicit expiry wins.
    expect(creditGrantFor(base, now, { periodEnd })?.expires_at).toBe("2027-01-25T12:00:00.000Z");
  });
  it("nothing to grant for zero credits", () => {
    expect(creditGrantFor({ ...base, credits: 0 }, now)).toBeNull();
  });
});

describe("refunds", () => {
  it("refundStatus", () => {
    expect(refundStatus(5000, 0)).toBe("succeeded");
    expect(refundStatus(5000, 1000)).toBe("partially_refunded");
    expect(refundStatus(5000, 5000)).toBe("refunded");
  });
  it("refundableCents only for paid payments", () => {
    expect(refundableCents({ amount_cents: 5000, amount_refunded_cents: 1000, status: "partially_refunded" })).toBe(4000);
    expect(refundableCents({ amount_cents: 5000, amount_refunded_cents: 0, status: "pending" })).toBe(0);
    expect(refundableCents({ amount_cents: 5000, amount_refunded_cents: 5000, status: "refunded" })).toBe(0);
  });
  it("charge.refunded maps to payment update", () => {
    expect(
      paymentUpdateFromCharge({ id: "ch_1", amount: 9000, amount_refunded: 4500, receipt_url: "https://r" } as Stripe.Charge),
    ).toEqual({ stripe_charge_id: "ch_1", amount_refunded_cents: 4500, status: "partially_refunded", receipt_url: "https://r" });
  });
});

describe("paymentUpdateFromCheckout", () => {
  const session = {
    payment_status: "paid",
    amount_total: 8100,
    payment_intent: "pi_1",
    currency: "usd",
    customer_details: { email: "a@b.co" },
  } as unknown as Stripe.Checkout.Session;

  it("completed + paid => succeeded with discounted total", () => {
    expect(paymentUpdateFromCheckout(session, "completed", now)).toEqual({
      stripe_payment_intent_id: "pi_1",
      amount_cents: 8100,
      currency: "usd",
      payer_email: "a@b.co",
      status: "succeeded",
      paid_at: now.toISOString(),
    });
  });
  it("completed + unpaid (async method) stays pending", () => {
    expect(paymentUpdateFromCheckout({ ...session, payment_status: "unpaid" }, "completed", now).status).toBe("pending");
  });
  it("async outcomes and expiry", () => {
    expect(paymentUpdateFromCheckout(session, "async_succeeded", now).status).toBe("succeeded");
    expect(paymentUpdateFromCheckout(session, "async_failed", now).status).toBe("failed");
    expect(paymentUpdateFromCheckout(session, "expired", now)).toEqual({ status: "cancelled" });
  });
});

describe("invoices", () => {
  const invoice = {
    id: "in_1",
    amount_paid: 15000,
    amount_due: 15000,
    currency: "usd",
    hosted_invoice_url: "https://inv",
    invoice_pdf: "https://pdf",
    number: "ABC-0001",
    customer_email: "c@d.co",
    billing_reason: "subscription_cycle",
    status_transitions: { paid_at: nowS },
    parent: { type: "subscription_details", quote_details: null, subscription_details: { subscription: "sub_1", metadata: {} } },
    payments: {
      data: [
        { status: "canceled", is_default: false, payment: { type: "payment_intent", payment_intent: "pi_old" } },
        { status: "paid", is_default: true, payment: { type: "payment_intent", payment_intent: { id: "pi_paid" } } },
      ],
    },
  } as unknown as Stripe.Invoice;

  it("finds the subscription via invoice.parent", () => {
    expect(invoiceSubscriptionId(invoice)).toBe("sub_1");
    expect(invoiceSubscriptionId({ parent: null })).toBeNull();
  });
  it("finds the paying PaymentIntent via invoice.payments", () => {
    expect(invoicePaymentIntentId(invoice)).toBe("pi_paid");
    expect(invoicePaymentIntentId({ payments: undefined })).toBeNull();
  });
  it("maps paid invoices to payment rows", () => {
    expect(paymentFromInvoice(invoice, "paid")).toMatchObject({
      stripe_invoice_id: "in_1",
      stripe_payment_intent_id: "pi_paid",
      amount_cents: 15000,
      status: "succeeded",
      paid_at: now.toISOString(),
      hosted_invoice_url: "https://inv",
      metadata: { invoice_number: "ABC-0001", invoice_pdf: "https://pdf", billing_reason: "subscription_cycle" },
    });
    expect(paymentFromInvoice(invoice, "failed")).toMatchObject({ status: "failed", paid_at: null });
  });
  it("grants credits only at period starts", () => {
    expect(invoiceGrantsCredits({ billing_reason: "subscription_create", amount_paid: 0 })).toBe(true);
    expect(invoiceGrantsCredits({ billing_reason: "subscription_cycle", amount_paid: 100 })).toBe(true);
    expect(invoiceGrantsCredits({ billing_reason: "subscription_update", amount_paid: 100 })).toBe(false);
    expect(invoiceGrantsCredits({ billing_reason: "manual", amount_paid: 100 })).toBe(false);
  });
});

describe("subscriptionRowFromStripe", () => {
  const sub = {
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    trial_end: null,
    items: {
      data: [{ price: { id: "price_1" }, current_period_start: nowS, current_period_end: nowS + 30 * 86_400 }],
    },
  } as unknown as Stripe.Subscription;

  it("reads periods from subscription items", () => {
    expect(subscriptionRowFromStripe(sub)).toEqual({
      status: "active",
      stripe_price_id: "price_1",
      current_period_start: now.toISOString(),
      current_period_end: new Date((nowS + 30 * 86_400) * 1000).toISOString(),
      cancel_at_period_end: false,
      canceled_at: null,
      trial_end: null,
    });
  });
  it("treats cancel_at as a scheduled cancellation", () => {
    expect(subscriptionRowFromStripe({ ...sub, cancel_at: nowS + 1000 }).cancel_at_period_end).toBe(true);
    expect(subscriptionRowFromStripe({ ...sub, cancel_at_period_end: true }).cancel_at_period_end).toBe(true);
  });
  it("ended subscriptions are not 'cancelling'", () => {
    const row = subscriptionRowFromStripe({ ...sub, status: "canceled", cancel_at_period_end: true, canceled_at: nowS });
    expect(row.cancel_at_period_end).toBe(false);
    expect(row.canceled_at).toBe(now.toISOString());
  });
});

describe("revenue", () => {
  it("normalises recurring prices to monthly", () => {
    expect(monthlyRecurringCents(20000, "month")).toBe(20000);
    expect(monthlyRecurringCents(120000, "year")).toBe(10000);
    expect(monthlyRecurringCents(5000, "week")).toBe(21667);
    expect(monthlyRecurringCents(30000, "month", 3)).toBe(10000);
    expect(monthlyRecurringCents(30000, null)).toBe(0);
  });
  it("net revenue subtracts refunds and ignores unpaid", () => {
    expect(netRevenueCents({ amount_cents: 5000, amount_refunded_cents: 2000, status: "partially_refunded" })).toBe(3000);
    expect(netRevenueCents({ amount_cents: 5000, amount_refunded_cents: 5000, status: "refunded" })).toBe(0);
    expect(netRevenueCents({ amount_cents: 5000, amount_refunded_cents: 0, status: "failed" })).toBe(0);
  });
  it("lists months in the trainer's timezone", () => {
    expect(lastMonths(new Date("2026-01-01T03:00:00Z"), "America/Denver", 3)).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(lastMonths(now, "UTC", 2)).toEqual(["2026-09", "2026-10"]);
  });
  it("buckets by local month", () => {
    const rows = [
      { paid_at: "2026-10-01T05:00:00Z", amount_cents: 1000, amount_refunded_cents: 0, status: "succeeded" as const }, // Sep 30 in Denver
      { paid_at: "2026-10-15T18:00:00Z", amount_cents: 5000, amount_refunded_cents: 1000, status: "partially_refunded" as const },
      { paid_at: null, amount_cents: 9999, amount_refunded_cents: 0, status: "pending" as const },
      { paid_at: "2024-01-01T00:00:00Z", amount_cents: 7777, amount_refunded_cents: 0, status: "succeeded" as const }, // out of range
    ];
    const out = revenueByMonth(rows, "America/Denver", now, 12);
    expect(out).toHaveLength(12);
    expect(out.at(-1)).toEqual({ month: "2026-10", cents: 4000 });
    expect(out.at(-2)).toEqual({ month: "2026-09", cents: 1000 });
    expect(out.reduce((s, m) => s + m.cents, 0)).toBe(5000);
  });
});

describe("fees", () => {
  it("picks the configured fee", () => {
    const policy = { late_cancel_fee_cents: 2500, no_show_fee_cents: 9000 };
    expect(bookingFeeCents(policy, "late_cancel")).toBe(2500);
    expect(bookingFeeCents(policy, "no_show")).toBe(9000);
  });
  it("explains card failures", () => {
    expect(feeFailureMessage({ code: "authentication_required" })).toMatch(/authenticate/);
    expect(feeFailureMessage({ code: "card_declined", decline_code: "insufficient_funds" })).toMatch(/insufficient/);
    expect(feeFailureMessage({ code: "weird", message: "Nope" })).toBe("Nope");
  });
});
