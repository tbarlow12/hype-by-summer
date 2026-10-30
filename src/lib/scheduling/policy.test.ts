import { describe, expect, it } from "vitest";
import { bookingErrorMessage, canReschedule, decideCancellation, describePolicy, dueReminder, paymentOptions } from "./policy";

const policy = { cancellation_window_hours: 24, late_cancel_fee_cents: 2500, no_show_fee_cents: 5000, refund_on_cancel: true };
const now = new Date("2026-10-27T12:00:00Z");
const booking = (over: Partial<Parameters<typeof decideCancellation>[0]["booking"]> = {}) => ({
  status: "confirmed" as const,
  starts_at: "2026-10-30T12:00:00Z",
  payment_method: "stripe" as const,
  credits_used: 0,
  ...over,
});

describe("decideCancellation", () => {
  it("refunds card payments outside the window", () => {
    const d = decideCancellation({ booking: booking(), policy, now, actor: "client" });
    expect(d).toMatchObject({ allowed: true, late: false, status: "cancelled", refundPayment: true, chargeFee: false });
  });

  it("respects refund_on_cancel=false but still returns credits", () => {
    const card = decideCancellation({ booking: booking(), policy: { ...policy, refund_on_cancel: false }, now, actor: "client" });
    expect(card).toMatchObject({ allowed: true, refundPayment: false });
    const credits = decideCancellation({
      booking: booking({ payment_method: "credits", credits_used: 1 }),
      policy: { ...policy, refund_on_cancel: false },
      now,
      actor: "client",
    });
    expect(credits).toMatchObject({ allowed: true, refundCredits: true });
  });

  it("late cancels keep payment, forfeit credits and charge unpaid sessions a fee", () => {
    const soon = "2026-10-28T06:00:00Z"; // 18h away
    expect(decideCancellation({ booking: booking({ starts_at: soon }), policy, now, actor: "client" })).toMatchObject({
      late: true, status: "late_cancelled", refundPayment: false, chargeFee: false,
    });
    expect(
      decideCancellation({ booking: booking({ starts_at: soon, payment_method: "credits", credits_used: 1 }), policy, now, actor: "client" }),
    ).toMatchObject({ late: true, refundCredits: false, chargeFee: false });
    expect(decideCancellation({ booking: booking({ starts_at: soon, payment_method: "pay_later" }), policy, now, actor: "client" })).toMatchObject({
      late: true, chargeFee: true, feeCents: 2500,
    });
    expect(
      decideCancellation({ booking: booking({ starts_at: soon, payment_method: "free", is_consultation: true }), policy, now, actor: "client" }),
    ).toMatchObject({ late: true, chargeFee: false });
    expect(
      decideCancellation({ booking: booking({ starts_at: soon, payment_method: "pay_later" }), policy: { ...policy, late_cancel_fee_cents: 0 }, now, actor: "client" }),
    ).toMatchObject({ chargeFee: false });
  });

  it("lets coaches choose to refund, never late", () => {
    const soon = "2026-10-27T14:00:00Z";
    expect(decideCancellation({ booking: booking({ starts_at: soon }), policy, now, actor: "coach", coachRefund: true })).toMatchObject({
      late: false, status: "cancelled", refundPayment: true,
    });
    expect(decideCancellation({ booking: booking({ starts_at: soon }), policy, now, actor: "coach", coachRefund: false })).toMatchObject({
      refundPayment: false, refundCredits: false,
    });
  });

  it("releases pending holds without side effects", () => {
    expect(decideCancellation({ booking: booking({ status: "pending_payment" }), policy, now, actor: "client" })).toMatchObject({
      allowed: true, status: "cancelled", refundPayment: false, chargeFee: false,
    });
  });

  it("rejects inactive or past sessions", () => {
    expect(decideCancellation({ booking: booking({ status: "cancelled" }), policy, now, actor: "client" }).allowed).toBe(false);
    expect(decideCancellation({ booking: booking({ starts_at: "2026-10-27T11:00:00Z" }), policy, now, actor: "coach" }).allowed).toBe(false);
  });
});

describe("canReschedule", () => {
  it("blocks clients inside the window but not coaches", () => {
    const b = booking({ starts_at: "2026-10-28T06:00:00Z" });
    expect(canReschedule({ booking: b, policy, now, actor: "client" }).allowed).toBe(false);
    expect(canReschedule({ booking: b, policy, now, actor: "coach" }).allowed).toBe(true);
    expect(canReschedule({ booking: booking(), policy, now, actor: "client" }).allowed).toBe(true);
    expect(canReschedule({ booking: booking({ status: "pending_payment" }), policy, now, actor: "coach" }).allowed).toBe(false);
  });
});

describe("copy", () => {
  it("describes the policy", () => {
    const text = describePolicy(policy);
    expect(text).toContain("24 hours");
    expect(text).toContain("$25");
    expect(text).toContain("$50");
    expect(describePolicy({ ...policy, cancellation_window_hours: 0 })).toContain("any time");
  });

  it("maps RPC errors", () => {
    expect(bookingErrorMessage("slot_full")).toMatch(/filled up/);
    expect(bookingErrorMessage("slot_conflict")).toMatch(/just taken/);
    expect(bookingErrorMessage("slot_unavailable")).toMatch(/no longer available/);
    expect(bookingErrorMessage("already_booked")).toMatch(/already booked/);
    expect(bookingErrorMessage("weird")).toMatch(/try again/);
  });
});

describe("dueReminder", () => {
  const base = { starts_at: "2026-10-28T12:00:00Z", created_at: "2026-10-20T00:00:00Z", reminders_sent: [] as number[], reminderHours: [24, 2] };

  it("is quiet before the first reminder point", () => {
    expect(dueReminder({ ...base, now: new Date("2026-10-27T11:00:00Z") })).toEqual({ send: null, mark: [] });
  });

  it("sends the 24h reminder, then the 2h one", () => {
    expect(dueReminder({ ...base, now: new Date("2026-10-27T12:05:00Z") })).toEqual({ send: 24, mark: [24] });
    expect(dueReminder({ ...base, reminders_sent: [24], now: new Date("2026-10-28T10:01:00Z") })).toEqual({ send: 2, mark: [2] });
    expect(dueReminder({ ...base, reminders_sent: [24, 2], now: new Date("2026-10-28T11:00:00Z") })).toEqual({ send: null, mark: [] });
  });

  it("collapses missed reminders into one", () => {
    expect(dueReminder({ ...base, now: new Date("2026-10-28T11:00:00Z") })).toEqual({ send: 2, mark: [24, 2] });
  });

  it("skips reminders whose moment passed before booking", () => {
    const created = "2026-10-28T00:00:00Z"; // 12h before
    expect(dueReminder({ ...base, created_at: created, now: new Date("2026-10-28T01:00:00Z") })).toEqual({ send: null, mark: [24] });
    expect(dueReminder({ ...base, created_at: created, reminders_sent: [24], now: new Date("2026-10-28T10:30:00Z") })).toEqual({ send: 2, mark: [2] });
  });

  it("never reminds after the start", () => {
    expect(dueReminder({ ...base, now: new Date("2026-10-28T12:30:00Z") })).toEqual({ send: null, mark: [] });
  });
});

describe("paymentOptions", () => {
  const st = { price_cents: 9000, requires_payment: true, is_consultation: false, allow_credits: true, credits_required: 1 };
  it("offers card, plus credits when the balance covers it", () => {
    expect(paymentOptions(st, null)).toEqual(["stripe"]);
    expect(paymentOptions(st, 0)).toEqual(["stripe"]);
    expect(paymentOptions(st, 2)).toEqual(["credits", "stripe"]);
    expect(paymentOptions({ ...st, allow_credits: false }, 5)).toEqual(["stripe"]);
    expect(paymentOptions({ ...st, credits_required: 3 }, 2)).toEqual(["stripe"]);
  });
  it("uses pay later when payment is not required, free for consults", () => {
    expect(paymentOptions({ ...st, requires_payment: false }, null)).toEqual(["pay_later"]);
    expect(paymentOptions({ ...st, is_consultation: true }, 5)).toEqual(["free"]);
    expect(paymentOptions({ ...st, price_cents: 0 }, 5)).toEqual(["free"]);
    // Business without a connected Stripe account: pay at the session instead.
    expect(paymentOptions(st, null, false)).toEqual(["pay_later"]);
    expect(paymentOptions(st, 2, false)).toEqual(["credits", "pay_later"]);
  });
});
