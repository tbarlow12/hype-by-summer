// Which side of the platform a Stripe webhook event belongs to. Pure (see
// routing.test.ts).
//
// - Connect events carry `event.account` (the business's connected account):
//   client checkouts, invoices, subscriptions, refunds, account status.
// - Platform events have no `account`: the businesses' own Pro plan
//   subscriptions, and application fees (whose object names the account).

/** Enable on the platform endpoint ("Events on your account"). */
export const PLATFORM_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "application_fee.created",
  "application_fee.refunded",
] as const;

/** Enable on the Connect endpoint ("Events on connected accounts"). */
export const CONNECT_EVENTS = [
  "account.updated",
  "account.application.deauthorized",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "payment_intent.payment_failed",
] as const;

export type EventRoute =
  | { scope: "connect"; account: string }
  | { scope: "platform"; account: string | null };

type RoutableEvent = {
  type: string;
  account?: string | null;
  data: { object: unknown };
};

const accountOf = (v: unknown): string | null => {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string") return (v as { id: string }).id;
  return null;
};

/**
 * Route an event. Connect events go to the business that owns
 * `event.account`. Platform application-fee events name the account on the
 * fee object; `account.updated` delivered to the platform endpoint names it
 * as the object id.
 */
export function routeEvent(event: RoutableEvent): EventRoute {
  if (event.account) return { scope: "connect", account: event.account };
  const obj = event.data.object as Record<string, unknown> | null;
  if (event.type.startsWith("application_fee.")) return { scope: "platform", account: accountOf(obj?.account) };
  if (event.type === "account.updated" && obj?.object === "account") return { scope: "connect", account: accountOf(obj.id)! };
  return { scope: "platform", account: null };
}

/** Is a platform-account object one of the businesses' Pro plan objects? */
export function isPlatformPlanObject(md: Record<string, string> | null | undefined): boolean {
  return md?.kind === "platform_plan" && Boolean(md.business_id);
}
