import { formatMoney } from "@/lib/format";
import type { Tables } from "@/lib/supabase/database.types";

type Offering = Tables<"offerings">;

/** "$120", "$199 / month", "$500 / 3 months". */
export function priceLabel(o: Pick<Offering, "price_cents" | "currency" | "kind" | "billing_interval" | "interval_count">) {
  const price = formatMoney(o.price_cents, o.currency);
  if (o.kind !== "subscription" || !o.billing_interval) return price;
  return o.interval_count > 1 ? `${price} / ${o.interval_count} ${o.billing_interval}s` : `${price} / ${o.billing_interval}`;
}

export const PAYMENT_STATUS_TONE = {
  pending: "amber",
  succeeded: "green",
  failed: "red",
  refunded: "neutral",
  partially_refunded: "blue",
  cancelled: "neutral",
} as const;

export const SUBSCRIPTION_STATUS_TONE: Record<string, "green" | "blue" | "amber" | "red" | "neutral"> = {
  active: "green",
  trialing: "blue",
  past_due: "amber",
  unpaid: "red",
  incomplete: "amber",
  canceled: "neutral",
  incomplete_expired: "neutral",
  paused: "neutral",
};

export const PURPOSE_LABEL: Record<Tables<"payments">["purpose"], string> = {
  booking: "Session",
  package: "Package",
  subscription: "Membership",
  one_time: "Product",
  invoice: "Invoice",
  fee: "Fee",
  tip: "Tip",
};
