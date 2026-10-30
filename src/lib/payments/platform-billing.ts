import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { PLATFORM_NAME } from "@/lib/platform";
import { businessUrl } from "@/lib/tenant";
import {
  PRO_PRICE_DEFAULT_CENTS,
  PRO_PRICE_LOOKUP_KEY,
  proPriceCents,
  applicationFeePercent,
  planForSubscriptionStatus,
  shouldApplyPlatformSubscription,
} from "@/lib/payments/fees";
import { idOf, subscriptionRowFromStripe } from "@/lib/payments/mapping";
import { createPortalSession } from "@/lib/payments/portal";
import { isMissing, loadBusiness, type Admin, type Business } from "@/lib/payments/shared";

// The platform's own billing of businesses (on the platform Stripe account,
// never a connected account). Starter is free with an application fee on
// client payments; Pro is a monthly platform subscription with no fee.

const PLATFORM_PLAN = "platform_plan";
let cachedProPrice: string | null = null;

/**
 * Pro plan price: PLATFORM_PRO_PRICE_ID, else a monthly price for
 * PLATFORM_PRO_PRICE_DOLLARS (default $49) found by lookup key or created on
 * first use. Changing the dollar amount creates a new price for new upgrades.
 */
export async function proPriceId(): Promise<string> {
  const configured = process.env.PLATFORM_PRO_PRICE_ID?.trim();
  if (configured) return configured;
  if (cachedProPrice) return cachedProPrice;
  const cents = proPriceCents(process.env.PLATFORM_PRO_PRICE_DOLLARS);
  const lookupKey = `${PRO_PRICE_LOOKUP_KEY}_${cents}`;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found.data[0]) return (cachedProPrice = found.data[0].id);
  const product = await s.products
    .create(
      { id: "platform_pro", name: `${PLATFORM_NAME} Pro`, description: "No platform fee on client payments.", metadata: { kind: PLATFORM_PLAN } },
      { idempotencyKey: "platform-pro-product:v1" },
    )
    .catch(async (e: { code?: string }) => {
      if (e.code === "resource_already_exists") return s.products.retrieve("platform_pro");
      throw e;
    });
  const price = await s.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: cents,
      recurring: { interval: "month" },
      lookup_key: lookupKey,
      metadata: { kind: PLATFORM_PLAN },
    },
    { idempotencyKey: `platform-pro-price:${cents}` },
  );
  return (cachedProPrice = price.id);
}

/** Pro price details for display (best-effort). */
export async function proPrice(): Promise<{ cents: number; currency: string; interval: string } | null> {
  try {
    const p = await stripe().prices.retrieve(await proPriceId());
    return { cents: p.unit_amount ?? PRO_PRICE_DEFAULT_CENTS, currency: p.currency, interval: p.recurring?.interval ?? "month" };
  } catch (err) {
    console.error("[platform-billing] pro price lookup failed", err);
    return null;
  }
}

/** The business's customer on the platform account. */
async function ensurePlatformCustomer(admin: Admin, business: Business): Promise<string> {
  if (business.platform_customer_id) {
    try {
      const c = await stripe().customers.retrieve(business.platform_customer_id);
      if (!("deleted" in c && c.deleted)) return c.id;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  const { data: owner } = await admin
    .from("business_members")
    .select("profile:profiles!business_members_user_id_fkey(email)")
    .eq("business_id", business.id)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  const customer = await stripe().customers.create(
    {
      name: business.name,
      email: business.support_email ?? owner?.profile?.email ?? undefined,
      metadata: { business_id: business.id, kind: PLATFORM_PLAN },
    },
    { idempotencyKey: `platform-customer:${business.id}:${business.platform_customer_id ?? "new"}` },
  );
  await admin.from("businesses").update({ platform_customer_id: customer.id }).eq("id", business.id);
  return customer.id;
}

/** The business's current platform subscription from Stripe, if any. */
export async function currentPlatformSubscription(business: Business): Promise<Stripe.Subscription | null> {
  if (!business.platform_subscription_id) return null;
  try {
    return await stripe().subscriptions.retrieve(business.platform_subscription_id);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

const LIVE = new Set(["active", "trialing", "past_due"]);

/**
 * Upgrade to Pro. Resumes a Pro plan that was set to end; otherwise returns a
 * platform Checkout URL for the Pro subscription.
 */
export async function startPro(businessId: string): Promise<{ url: string } | { resumed: true } | { already: true }> {
  const admin = createAdminClient();
  const business = await loadBusiness(admin, businessId);
  const current = await currentPlatformSubscription(business);
  if (current && LIVE.has(current.status)) {
    if (!current.cancel_at_period_end && current.cancel_at == null) return { already: true };
    const resumed = await stripe().subscriptions.update(current.id, { cancel_at_period_end: false, cancel_at: "" });
    await applyPlatformSubscription(admin, resumed);
    return { resumed: true };
  }

  const customer = await ensurePlatformCustomer(admin, business);
  const metadata = { kind: PLATFORM_PLAN, business_id: business.id };
  const window = Math.floor(Date.now() / 600_000);
  const session = await stripe().checkout.sessions.create(
    {
      mode: "subscription",
      customer,
      client_reference_id: business.id,
      line_items: [{ price: await proPriceId(), quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      success_url: businessUrl(business, "/coach/payments/plan?upgraded=1&session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: businessUrl(business, "/coach/payments/plan"),
    },
    { idempotencyKey: `platform-pro-checkout:${business.id}:${window}` },
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}

/** Back to Starter: the Pro subscription ends at the close of the paid period. */
export async function scheduleStarter(businessId: string): Promise<{ endsAt: string | null }> {
  const admin = createAdminClient();
  const business = await loadBusiness(admin, businessId);
  const current = await currentPlatformSubscription(business);
  if (!current || !LIVE.has(current.status)) {
    // Nothing billed: just make sure the business is on Starter.
    if (business.plan !== "starter") await setPlan(admin, business, "starter", current?.status ?? null, current?.id ?? null);
    return { endsAt: null };
  }
  const updated = await stripe().subscriptions.update(current.id, { cancel_at_period_end: true });
  await applyPlatformSubscription(admin, updated);
  return { endsAt: subscriptionRowFromStripe(updated).current_period_end };
}

/** Customer Portal on the platform account (card, invoices) for the business's plan. */
export async function platformPortalUrl(businessId: string): Promise<string> {
  const admin = createAdminClient();
  const business = await loadBusiness(admin, businessId);
  const customer = await ensurePlatformCustomer(admin, business);
  return createPortalSession({
    customerId: customer,
    returnUrl: businessUrl(business, "/coach/payments/plan"),
    headline: `${PLATFORM_NAME} plan billing`,
  });
}

async function businessForPlatformObject(
  admin: Admin,
  md: Record<string, string> | null | undefined,
  customer: string | null,
): Promise<Business | null> {
  if (md?.business_id) {
    const { data } = await admin.from("businesses").select("*").eq("id", md.business_id).maybeSingle();
    if (data) return data;
  }
  if (customer) {
    const { data } = await admin.from("businesses").select("*").eq("platform_customer_id", customer).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function setPlan(admin: Admin, business: Business, plan: "starter" | "pro", status: string | null, subscriptionId: string | null) {
  await admin
    .from("businesses")
    .update({ plan, platform_subscription_status: status, platform_subscription_id: subscriptionId })
    .eq("id", business.id);
  if (plan !== business.plan) {
    await syncClientSubscriptionFees({ ...business, plan });
    const { data: owners } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", business.id)
      .eq("active", true)
      .in("role", ["owner", "admin"]);
    for (const o of owners ?? []) {
      await notify({
        userId: o.user_id,
        businessId: business.id,
        type: "platform_plan",
        title: plan === "pro" ? "You're on the Pro plan" : "You're on the Starter plan",
        body: plan === "pro" ? "No platform fee is taken from client payments." : "A small platform fee now applies to client payments.",
        link: "/coach/payments/plan",
      });
    }
  }
}

/** Mirror a platform Pro subscription onto its business (plan, status, id). */
export async function applyPlatformSubscription(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const business = await businessForPlatformObject(admin, sub.metadata, idOf(sub.customer));
  if (!business) return; // Not a platform plan subscription (e.g. legacy pre-Connect data).
  if (!shouldApplyPlatformSubscription(business, sub)) return;
  await setPlan(admin, business, planForSubscriptionStatus(sub.status), sub.status, sub.id);
  if (!business.platform_customer_id && sub.customer) {
    await admin.from("businesses").update({ platform_customer_id: idOf(sub.customer) }).eq("id", business.id).is("platform_customer_id", null);
  }
}

/** Success page: apply a completed Pro checkout right away (the webhook does the same). */
export async function syncProCheckout(businessId: string, sessionId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.kind !== PLATFORM_PLAN || session.metadata.business_id !== businessId) return;
  if (session.status === "complete") await handlePlatformCheckout(createAdminClient(), session);
}

/** Platform webhook: Pro checkout completed. */
export async function handlePlatformCheckout(admin: Admin, session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.kind !== PLATFORM_PLAN || !session.subscription) return;
  const sub = await stripe().subscriptions.retrieve(idOf(session.subscription)!);
  await applyPlatformSubscription(admin, sub);
}

/** Platform webhook: customer.subscription.* (re-read for the latest state). */
export async function handlePlatformSubscription(admin: Admin, sub: Stripe.Subscription, deleted: boolean): Promise<void> {
  let latest = sub;
  if (!deleted) {
    try {
      latest = await stripe().subscriptions.retrieve(sub.id);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  await applyPlatformSubscription(admin, latest);
}

/** Platform webhook: invoice.paid / invoice.payment_failed on a Pro subscription. */
export async function handlePlatformInvoice(admin: Admin, invoice: Stripe.Invoice, outcome: "paid" | "failed"): Promise<void> {
  const subId = idOf(invoice.parent?.subscription_details?.subscription ?? null);
  if (!subId) return;
  const sub = await stripe().subscriptions.retrieve(subId);
  const business = await businessForPlatformObject(admin, sub.metadata, idOf(sub.customer));
  if (!business) return;
  await applyPlatformSubscription(admin, sub);
  if (outcome === "failed") {
    const { data: owners } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", business.id)
      .eq("active", true)
      .in("role", ["owner", "admin"]);
    for (const o of owners ?? []) {
      await notify({
        userId: o.user_id,
        businessId: business.id,
        type: "platform_payment_failed",
        title: "Your Pro plan payment failed",
        body: "Update your card to stay on Pro. If it isn't paid, you'll move to the Starter plan.",
        link: "/coach/payments/plan",
        email: true,
      });
    }
  }
}

/**
 * After a plan change, put every live client membership of the business on
 * the new fee: Starter adds application_fee_percent, Pro removes it.
 */
export async function syncClientSubscriptionFees(business: Business): Promise<{ updated: number; failed: number }> {
  if (!business.stripe_account_id) return { updated: 0, failed: 0 };
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("business_id", business.id)
    .in("status", ["active", "trialing", "past_due", "unpaid", "incomplete"]);
  const pct = applicationFeePercent(business);
  let updated = 0;
  let failed = 0;
  for (const s of subs ?? []) {
    try {
      await stripe().subscriptions.update(
        s.stripe_subscription_id,
        { application_fee_percent: pct ?? "" },
        { stripeAccount: business.stripe_account_id },
      );
      updated++;
    } catch (err) {
      failed++;
      console.error("[platform-billing] subscription fee update failed", s.stripe_subscription_id, err);
    }
  }
  return { updated, failed };
}
