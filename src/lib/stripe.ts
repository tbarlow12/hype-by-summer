import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env.server";

let client: Stripe | null = null;

export function stripe(): Stripe {
  client ??= new Stripe(serverEnv.stripeSecretKey(), {
    appInfo: { name: "hype-by-summer" },
    maxNetworkRetries: 2,
  });
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
