import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { serverEnv } from "@/lib/env.server";
import { processStripeEvent } from "@/lib/payments/webhook";

// Stripe signs the exact bytes it sent, so read the raw body and stay on Node.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe-Signature header", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, serverEnv.stripeWebhookSecret());
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed", err instanceof Error ? err.message : err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed`, err);
    // 500 => Stripe retries with backoff; the error is stored on stripe_events.
    return Response.json({ received: false, error: "Handler failed" }, { status: 500 });
  }
}
