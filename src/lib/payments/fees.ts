// Platform plan + application fee math. Pure (see fees.test.ts).
//
// Starter: no monthly fee; the platform takes platform_fee_bps of every
// client payment as a Stripe application fee. Pro: a flat monthly platform
// subscription and no fee. Every feature is available on both plans.

export type Plan = "starter" | "pro";
export type FeePolicy = { plan: string; platform_fee_bps: number };

export const PRO_PRICE_DEFAULT_CENTS = 4900;
export const PRO_PRICE_LOOKUP_KEY = "platform_pro_monthly";

function feeBps(b: FeePolicy): number {
  if (b.plan !== "starter") return 0;
  return Math.max(0, Math.floor(b.platform_fee_bps));
}

/**
 * `application_fee_amount` for a one-time charge (Checkout payment mode,
 * PaymentIntents, one-off invoices). Undefined when there is no fee.
 */
export function applicationFeeAmount(amountCents: number, b: FeePolicy): number | undefined {
  const bps = feeBps(b);
  if (bps <= 0 || !(amountCents > 0)) return undefined;
  const fee = Math.round((amountCents * bps) / 10_000);
  return fee > 0 ? Math.min(fee, amountCents) : undefined;
}

/** `application_fee_percent` for subscriptions. Undefined when there is no fee. */
export function applicationFeePercent(b: FeePolicy): number | undefined {
  const bps = feeBps(b);
  return bps > 0 ? bps / 100 : undefined;
}

/** "3%" / "2.5%" for display. */
export function feePercentLabel(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** Platform subscription statuses that keep a business on Pro (incl. dunning). */
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The plan a business is on given its platform subscription's status. */
export function planForSubscriptionStatus(status: string | null | undefined): Plan {
  return status && PRO_STATUSES.has(status) ? "pro" : "starter";
}

/**
 * Should an incoming platform subscription update the business? A business
 * has at most one current platform subscription: events for an older
 * subscription that ended must not downgrade a newer active one.
 */
export function shouldApplyPlatformSubscription(
  current: { platform_subscription_id: string | null; platform_subscription_status: string | null },
  incoming: { id: string; status: string },
): boolean {
  if (!current.platform_subscription_id || current.platform_subscription_id === incoming.id) return true;
  // A different subscription: take it if it's live, or if the stored one is no longer live.
  return PRO_STATUSES.has(incoming.status) || !PRO_STATUSES.has(current.platform_subscription_status ?? "");
}
