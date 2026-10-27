import "server-only";
import { stripe } from "@/lib/stripe";
import { absoluteUrl, BRAND_NAME } from "@/lib/env";

let cachedConfigId: string | null = null;

/**
 * The Customer Portal configuration to use. Uses the account's default
 * configuration when one exists, otherwise creates one (payment methods,
 * invoice history, contact details and cancel-at-period-end).
 */
async function portalConfiguration(): Promise<string> {
  if (cachedConfigId) return cachedConfigId;
  const s = stripe();
  const existing = await s.billingPortal.configurations.list({ active: true, limit: 20 });
  const found = existing.data.find((c) => c.is_default) ?? existing.data.find((c) => c.metadata?.app === "hype-by-summer");
  if (found) return (cachedConfigId = found.id);

  const created = await s.billingPortal.configurations.create(
    {
      name: `${BRAND_NAME} billing`,
      business_profile: { headline: `Manage your ${BRAND_NAME} billing` },
      default_return_url: absoluteUrl("/me/billing"),
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "phone"] },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
      metadata: { app: "hype-by-summer" },
    },
    { idempotencyKey: `portal-configuration:v1:${absoluteUrl("/me/billing")}` },
  );
  return (cachedConfigId = created.id);
}

/** Stripe Customer Portal session URL for a customer. */
export async function createPortalSession(customerId: string, returnPath = "/me/billing"): Promise<string> {
  const configuration = await portalConfiguration();
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    configuration,
    return_url: absoluteUrl(returnPath),
  });
  return session.url;
}
