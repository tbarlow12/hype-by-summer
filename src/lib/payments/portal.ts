import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

// Stripe Customer Portal. Clients use it on their business's connected
// account; businesses use it on the platform account for their Pro plan.

const APP_TAG = "trainer-platform";
const cachedConfig = new Map<string, string>();

/**
 * The portal configuration for an account (connected account id, or
 * "platform"). Uses the account's default configuration when one exists,
 * otherwise creates ours (payment methods, invoices, contact details and
 * cancel-at-period-end).
 */
async function portalConfiguration(opts: Stripe.RequestOptions, headline: string): Promise<string> {
  const key = opts.stripeAccount ?? "platform";
  const hit = cachedConfig.get(key);
  if (hit) return hit;
  const s = stripe();
  const existing = await s.billingPortal.configurations.list({ active: true, limit: 20 }, opts);
  const found = existing.data.find((c) => c.is_default) ?? existing.data.find((c) => c.metadata?.app === APP_TAG);
  if (found) {
    cachedConfig.set(key, found.id);
    return found.id;
  }
  const created = await s.billingPortal.configurations.create(
    {
      business_profile: { headline },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "phone"] },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
      metadata: { app: APP_TAG },
    },
    { ...opts, idempotencyKey: `portal-configuration:v2:${key}` },
  );
  cachedConfig.set(key, created.id);
  return created.id;
}

/**
 * Customer Portal URL for a customer. Pass the connected account for client
 * billing; omit it for platform (Pro plan) billing.
 */
export async function createPortalSession(input: {
  customerId: string;
  returnUrl: string;
  account?: string | null;
  headline: string;
}): Promise<string> {
  const opts: Stripe.RequestOptions = input.account ? { stripeAccount: input.account } : {};
  const configuration = await portalConfiguration(opts, input.headline);
  const session = await stripe().billingPortal.sessions.create(
    { customer: input.customerId, configuration, return_url: input.returnUrl },
    opts,
  );
  return session.url;
}
