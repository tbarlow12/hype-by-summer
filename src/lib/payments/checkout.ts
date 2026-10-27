import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { absoluteUrl } from "@/lib/env";
import { getOrCreateStripeCustomer } from "@/lib/payments/customers";
import { checkoutExpiresAt, idOf } from "@/lib/payments/mapping";
import { isOfferingSynced, syncOfferingToStripe } from "@/lib/payments/offerings";
import { automaticTaxEnabled } from "@/lib/payments/shared";

// OWNER: payments. Contract used by scheduling.

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_payable" | "expired" | "already_subscribed" | "unavailable",
  ) {
    super(message);
  }
}

function taxParams(hasCustomer: boolean): Partial<Stripe.Checkout.SessionCreateParams> {
  if (!automaticTaxEnabled()) return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "auto",
    // Stripe Tax needs the customer's address saved on the customer object.
    ...(hasCustomer ? { customer_update: { address: "auto", name: "auto" } } : {}),
  };
}

/**
 * Creates a Stripe Checkout Session for a `pending_payment` booking and stores
 * its id on the booking. The Stripe webhook later confirms the booking and
 * calls onBookingConfirmed(). Returns the Checkout URL to redirect to.
 */
export async function createBookingCheckout(bookingId: string): Promise<{ url: string }> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("*, session_types(name, slug, currency)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw new CheckoutError("Booking not found", "not_found");
  if (booking.status !== "pending_payment") throw new CheckoutError("This booking doesn't need payment", "not_payable");
  if (booking.price_cents <= 0) throw new CheckoutError("This booking is free", "not_payable");
  if (booking.hold_expires_at && new Date(booking.hold_expires_at) <= new Date()) {
    throw new CheckoutError("Your hold on this time slot expired. Please pick a time again.", "expired");
  }

  const s = stripe();

  // Reuse a still-open session (double clicks, back button).
  if (booking.stripe_checkout_session_id) {
    try {
      const existing = await s.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
      if (existing.status === "open" && existing.url) return { url: existing.url };
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
  }

  const sessionType = booking.session_types;
  const [{ data: storefront }, { data: trainer }] = await Promise.all([
    admin.from("trainer_profiles").select("slug").eq("trainer_id", booking.trainer_id).maybeSingle(),
    admin.from("profiles").select("timezone").eq("id", booking.trainer_id).maybeSingle(),
  ]);
  const tz = booking.client_timezone ?? trainer?.timezone ?? "UTC";
  const currency = (sessionType?.currency ?? "usd").toLowerCase();

  // Stripe needs >= 30 minutes; keep the slot held for as long as checkout is open.
  const expiresAt = checkoutExpiresAt(booking.hold_expires_at);
  const holdIso = new Date(expiresAt * 1000).toISOString();
  if (holdIso !== booking.hold_expires_at) {
    await admin.from("bookings").update({ hold_expires_at: holdIso }).eq("id", booking.id).eq("status", "pending_payment");
  }

  const customerId = booking.client_id ? await getOrCreateStripeCustomer(booking.client_id) : null;
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(booking.starts_at));

  const metadata = { kind: "booking", booking_id: booking.id, trainer_id: booking.trainer_id, client_id: booking.client_id ?? "" };
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      ...(customerId
        ? { customer: customerId }
        : { customer_email: booking.guest_email ?? undefined, customer_creation: "always" as const }),
      client_reference_id: booking.client_id ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: booking.price_cents,
            product_data: {
              name: sessionType?.name ?? "Training session",
              description: when,
            },
          },
        },
      ],
      payment_intent_data: {
        // Saves the card so late-cancel / no-show fees can be charged later.
        setup_future_usage: "off_session",
        description: `${sessionType?.name ?? "Session"} – ${when}`,
        metadata,
      },
      metadata,
      allow_promotion_codes: true,
      expires_at: expiresAt,
      success_url: absoluteUrl(`/booking/${booking.manage_token}?status=success&session_id={CHECKOUT_SESSION_ID}`),
      // Back to the session type's booking page to pick again / retry.
      cancel_url: absoluteUrl(
        storefront && sessionType
          ? `/book/${storefront.slug}/${sessionType.slug}?checkout=cancelled`
          : `/booking/${booking.manage_token}?status=cancelled`,
      ),
      ...taxParams(Boolean(customerId)),
    },
    { idempotencyKey: `booking-checkout:${booking.id}:${expiresAt}` },
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  await admin.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", booking.id);
  // Pending payment row (one per checkout session).
  const { error: payErr } = await admin.from("payments").upsert(
    {
      trainer_id: booking.trainer_id,
      client_id: booking.client_id,
      payer_email: booking.guest_email,
      purpose: "booking",
      status: "pending",
      amount_cents: booking.price_cents,
      currency,
      description: `${sessionType?.name ?? "Session"} – ${when}`,
      booking_id: booking.id,
      stripe_checkout_session_id: session.id,
    },
    { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
  );
  if (payErr) console.error("[payments] pending booking payment insert failed", payErr);

  return { url: session.url };
}

/**
 * Checkout for a package, membership or one-off product bought by a signed-in
 * client. Prices always come from the DB / Stripe Price, never the client.
 */
export async function createOfferingCheckout(offeringId: string, clientId: string): Promise<{ url: string }> {
  const admin = createAdminClient();
  let { data: offering } = await admin.from("offerings").select("*").eq("id", offeringId).maybeSingle();
  if (!offering || !offering.active) throw new CheckoutError("That option is no longer available", "not_found");
  if (offering.price_cents <= 0) throw new CheckoutError("That option can't be purchased online", "unavailable");
  if (!offering.stripe_price_id || !isOfferingSynced(offering)) offering = await syncOfferingToStripe(offering.id);
  if (!offering.stripe_price_id) throw new CheckoutError("That option isn't ready for checkout yet", "unavailable");

  if (offering.kind === "subscription") {
    const { data: existing } = await admin
      .from("subscriptions")
      .select("id")
      .eq("client_id", clientId)
      .eq("offering_id", offering.id)
      .in("status", ["active", "trialing", "past_due"])
      .limit(1);
    if (existing && existing.length) throw new CheckoutError("You already have this membership", "already_subscribed");
  }

  const customerId = await getOrCreateStripeCustomer(clientId);
  const metadata = { kind: offering.kind, offering_id: offering.id, trainer_id: offering.trainer_id, client_id: clientId };
  const base: Stripe.Checkout.SessionCreateParams = {
    customer: customerId,
    client_reference_id: clientId,
    line_items: [{ price: offering.stripe_price_id, quantity: 1 }],
    metadata,
    allow_promotion_codes: true,
    success_url: absoluteUrl(`/checkout/success?session_id={CHECKOUT_SESSION_ID}`),
    cancel_url: absoluteUrl(`/checkout/cancelled?offering=${offering.id}`),
    ...taxParams(true),
  };

  const params: Stripe.Checkout.SessionCreateParams =
    offering.kind === "subscription"
      ? {
          ...base,
          mode: "subscription",
          subscription_data: {
            metadata,
            ...(offering.trial_days > 0 ? { trial_period_days: offering.trial_days } : {}),
          },
        }
      : {
          ...base,
          mode: "payment",
          payment_intent_data: { description: offering.name, metadata },
        };

  // A fresh key per 10-minute window: retries/double-clicks reuse the session.
  const window = Math.floor(Date.now() / 600_000);
  const key = `offering-checkout:${offering.id}:${clientId}:${offering.stripe_price_id}:${window}`;
  let session = await stripe().checkout.sessions.create(params, { idempotencyKey: key });
  // The cached session may already be paid (buying the same pack twice): start a new one.
  if (session.status !== "open") {
    session = await stripe().checkout.sessions.create(params, { idempotencyKey: `${key}:${Date.now()}` });
  }
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  if (offering.kind !== "subscription") {
    const { error } = await admin.from("payments").upsert(
      {
        trainer_id: offering.trainer_id,
        client_id: clientId,
        purpose: offering.kind,
        status: "pending",
        amount_cents: offering.price_cents,
        currency: offering.currency,
        description: offering.name,
        offering_id: offering.id,
        stripe_checkout_session_id: session.id,
      },
      { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
    );
    if (error) console.error("[payments] pending offering payment insert failed", error);
  }
  return { url: session.url };
}

/** Retrieve a checkout session the current client owns (for the success page). */
export async function retrieveOwnCheckoutSession(sessionId: string, clientId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const owner = session.metadata?.client_id || session.client_reference_id;
  if (owner !== clientId) return null;
  return { ...session, customerId: idOf(session.customer) };
}
