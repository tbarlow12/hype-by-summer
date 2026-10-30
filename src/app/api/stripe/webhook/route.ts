import type Stripe from "stripe";
import { stripe, webhookSecrets } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/payments/webhook";

// One endpoint for both Stripe webhook endpoints: the platform's own account
// (STRIPE_WEBHOOK_SECRET) and connected accounts (STRIPE_CONNECT_WEBHOOK_SECRET).
// Stripe signs the exact bytes it sent, so read the raw body and stay on Node.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe-Signature header", { status: 400 });
  const secrets = webhookSecrets();
  if (!secrets.length) {
    console.error("[stripe-webhook] no signing secret configured (STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET)");
    return new Response("Webhook not configured", { status: 500 });
  }

  const body = await req.text();
  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe().webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try the other endpoint's secret.
    }
  }
  if (!event) {
    console.warn("[stripe-webhook] signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} ${event.id}${event.account ? ` (${event.account})` : ""} failed`, err);
    // 500 => Stripe retries with backoff; the error is stored on stripe_events.
    return Response.json({ received: false, error: "Handler failed" }, { status: 500 });
  }
}
