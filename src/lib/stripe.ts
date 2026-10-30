import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env.server";

// The platform's Stripe client. Client charges are DIRECT charges on each
// business's connected account: pass onAccount(business.stripe_account_id)
// as the request options. Calls without it act on the platform's own account
// (platform plan billing, Connect onboarding, application fees).

let client: Stripe | null = null;

export function stripe(): Stripe {
  client ??= new Stripe(serverEnv.stripeSecretKey(), {
    appInfo: { name: "trainer-platform" },
    maxNetworkRetries: 2,
  });
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Request options that make a call act on a connected account. */
export function onAccount(accountId: string, extra: Stripe.RequestOptions = {}): Stripe.RequestOptions {
  return { ...extra, stripeAccount: accountId };
}

/**
 * Webhook signing secrets: the platform endpoint (STRIPE_WEBHOOK_SECRET) and
 * the Connect endpoint (STRIPE_CONNECT_WEBHOOK_SECRET). Both may point at
 * the same URL.
 */
export function webhookSecrets(): string[] {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => Boolean(s),
  );
}
