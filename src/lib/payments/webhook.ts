import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/lib/format";
import { absoluteUrl } from "@/lib/env";
import { onBookingConfirmed } from "@/lib/scheduling/lifecycle";
import {
  checkoutKind,
  creditGrantFor,
  idOf,
  invoiceGrantsCredits,
  invoiceSubscriptionId,
  paymentFromInvoice,
  paymentUpdateFromCharge,
  paymentUpdateFromCheckout,
  subscriptionRowFromStripe,
} from "@/lib/payments/mapping";
import { refundPayment } from "@/lib/payments/refunds";
import { isUniqueViolation, linkClientToTrainer, signedDownloadUrl, type Admin } from "@/lib/payments/shared";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";

type Payment = Tables<"payments">;
type CheckoutOutcome = "completed" | "async_succeeded" | "async_failed" | "expired";

/** Every event type the endpoint acts on (enable these in the Stripe dashboard). */
export const HANDLED_EVENTS = [
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

// ---------------------------------------------------------------------------
// Idempotent entry point
// ---------------------------------------------------------------------------

/**
 * Records the event in stripe_events first, skips it if it was already
 * processed, otherwise handles it and stores the outcome. Throws on handler
 * errors so the route returns 500 and Stripe retries.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<"processed" | "skipped"> {
  const admin = createAdminClient();
  const { error: insertErr } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, payload: event as unknown as Json });
  if (insertErr) {
    if (!isUniqueViolation(insertErr)) throw new Error(`stripe_events insert failed: ${insertErr.message}`);
    const { data: seen } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).single();
    if (seen?.processed_at) return "skipped";
    // Seen before but failed (or still in flight): handlers are idempotent, retry.
  }

  try {
    await handleStripeEvent(event, admin);
    await admin.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    await admin.from("stripe_events").update({ error: message.slice(0, 4000) }).eq("id", event.id);
    throw err;
  }
}

export async function handleStripeEvent(event: Stripe.Event, admin: Admin = createAdminClient()): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSession(admin, event.data.object, "completed");
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutSession(admin, event.data.object, "async_succeeded");
    case "checkout.session.async_payment_failed":
      return handleCheckoutSession(admin, event.data.object, "async_failed");
    case "checkout.session.expired":
      return handleCheckoutSession(admin, event.data.object, "expired");
    case "invoice.paid":
      return handleInvoice(admin, event.data.object, "paid");
    case "invoice.payment_failed":
      return handleInvoice(admin, event.data.object, "failed");
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionEvent(admin, event.data.object, event.type);
    case "charge.refunded":
      return handleChargeRefunded(admin, event.data.object);
    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(admin, event.data.object);
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Fulfil a Checkout Session. Safe to call repeatedly and from both the
 * webhook and the success page.
 */
export async function fulfillCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  await handleCheckoutSession(createAdminClient(), session, "completed");
}

async function handleCheckoutSession(admin: Admin, session: Stripe.Checkout.Session, outcome: CheckoutOutcome) {
  const kind = checkoutKind(session);
  if (!kind) return;
  if (kind === "subscription") {
    if (outcome === "completed" && session.subscription) {
      const sub = await stripe().subscriptions.retrieve(idOf(session.subscription)!);
      const row = await upsertSubscription(admin, sub);
      if (row) await linkClientToTrainer(admin, row.trainer_id, row.client_id);
    }
    return;
  }

  const { payment, transitioned } = await applyCheckoutPayment(admin, session, kind, outcome);
  if (!payment) return;
  if (payment.status === "succeeded" && payment.stripe_payment_intent_id && !payment.receipt_url) {
    await enrichFromPaymentIntent(admin, payment.id, payment.stripe_payment_intent_id);
  }
  // Guest checkouts create a customer; remember it on the client's profile.
  const customer = idOf(session.customer);
  if (customer && payment.client_id) {
    await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", payment.client_id).is("stripe_customer_id", null);
  }

  if (kind === "booking") return handleBookingCheckout(admin, session, payment, outcome);
  if (payment.status !== "succeeded") return;

  await linkClientToTrainer(admin, payment.trainer_id, payment.client_id);
  if (kind === "package") await grantPaymentCredits(admin, payment, "purchase");
  if (transitioned) await announcePurchase(admin, payment, kind);
}

/** Move the checkout's payment row to its new state (insert if missing). */
async function applyCheckoutPayment(
  admin: Admin,
  session: Stripe.Checkout.Session,
  kind: "booking" | "package" | "one_time",
  outcome: CheckoutOutcome,
): Promise<{ payment: Payment | null; transitioned: boolean }> {
  const update = paymentUpdateFromCheckout(session, outcome);
  // Only pending (or a failed async attempt) may move; never clobber refunds.
  const fromStatuses = outcome === "expired" ? ["pending"] : ["pending", "failed"];
  const { data: moved, error } = await admin
    .from("payments")
    .update(update)
    .eq("stripe_checkout_session_id", session.id)
    .in("status", fromStatuses as Payment["status"][])
    .select("*");
  if (error) throw new Error(`payments update failed: ${error.message}`);
  if (moved && moved.length) return { payment: moved[0]!, transitioned: update.status === "succeeded" };

  const { data: existing } = await admin.from("payments").select("*").eq("stripe_checkout_session_id", session.id).maybeSingle();
  if (existing) return { payment: existing, transitioned: false };
  if (outcome === "expired") return { payment: null, transitioned: false };

  // Row missing (created outside our flow or the insert failed): create it.
  const md = session.metadata ?? {};
  const trainerId = md.trainer_id;
  if (!trainerId) return { payment: null, transitioned: false };
  let description: string | null = null;
  if (md.offering_id) {
    const { data: o } = await admin.from("offerings").select("name").eq("id", md.offering_id).maybeSingle();
    description = o?.name ?? null;
  }
  const insert: TablesInsert<"payments"> = {
    trainer_id: trainerId,
    client_id: md.client_id || null,
    purpose: kind,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    description,
    booking_id: md.booking_id || null,
    offering_id: md.offering_id || null,
    stripe_checkout_session_id: session.id,
    ...update,
  };
  const { data: created, error: insErr } = await admin.from("payments").insert(insert).select("*").single();
  if (insErr) {
    if (isUniqueViolation(insErr)) {
      const { data: again } = await admin.from("payments").select("*").eq("stripe_checkout_session_id", session.id).maybeSingle();
      return { payment: again, transitioned: false };
    }
    throw new Error(`payments insert failed: ${insErr.message}`);
  }
  return { payment: created, transitioned: created.status === "succeeded" };
}

async function enrichFromPaymentIntent(admin: Admin, paymentId: string, paymentIntentId: string) {
  try {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (charge) {
      await admin.from("payments").update({ stripe_charge_id: charge.id, receipt_url: charge.receipt_url }).eq("id", paymentId);
    }
  } catch (err) {
    // Receipts are nice-to-have; never fail the event over them.
    console.error("[payments] receipt lookup failed", err);
  }
}

async function handleBookingCheckout(admin: Admin, session: Stripe.Checkout.Session, payment: Payment, outcome: CheckoutOutcome) {
  const bookingId = payment.booking_id ?? session.metadata?.booking_id;
  if (!bookingId) return;
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status, cancel_reason, client_id, trainer_id, guest_email, hold_expires_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return;

  if (outcome === "expired" || outcome === "async_failed") {
    const { data: cancelled } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancel_reason: outcome === "expired" ? "payment_not_completed" : "payment_failed",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", booking.id)
      .eq("status", "pending_payment")
      .select("id");
    if (outcome === "async_failed" && cancelled?.length && booking.client_id) {
      await notify({
        userId: booking.client_id,
        type: "payment_failed",
        title: "Your payment didn't go through",
        body: "Your session wasn't booked because the payment failed. Please book again with another payment method.",
        link: "/me/book",
        email: true,
      });
    }
    return;
  }

  if (payment.status === "pending") {
    // Delayed payment methods: keep the slot held while the payment clears.
    const hold = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await admin.from("bookings").update({ hold_expires_at: hold }).eq("id", booking.id).eq("status", "pending_payment");
    return;
  }
  if (payment.status !== "succeeded") return;

  if (booking.status === "pending_payment") {
    await admin
      .from("bookings")
      .update({ status: "confirmed", hold_expires_at: null, payment_method: "stripe" })
      .eq("id", booking.id)
      .eq("status", "pending_payment");
  } else if (booking.status === "cancelled" && booking.cancel_reason === "payment_not_completed") {
    // Paid after the hold lapsed and the slot was released: refund in full.
    await refundPayment(payment.id, { reason: "Paid after the booking hold expired" }, admin);
    await notify({
      userId: booking.trainer_id,
      type: "payment_refunded",
      title: "Late payment refunded",
      body: "A client paid after their booking hold expired, so the payment was refunded automatically.",
      link: "/coach/payments",
    });
    if (booking.client_id) {
      await notify({
        userId: booking.client_id,
        type: "payment_refunded",
        title: "Your payment was refunded",
        body: "Your hold on that time slot expired before the payment completed, so we refunded you in full. Please pick a new time.",
        link: "/me/book",
        email: true,
      });
    } else if (booking.guest_email) {
      await sendEmail({
        to: booking.guest_email,
        subject: "Your payment was refunded",
        heading: "Your payment was refunded",
        paragraphs: [
          "Your hold on that time slot expired before the payment completed, so we refunded you in full.",
          "Please pick a new time on the booking page.",
        ],
        cta: { label: "Book again", url: absoluteUrl("/") },
      });
    }
    return;
  }

  await linkClientToTrainer(admin, booking.trainer_id, booking.client_id);
  // onBookingConfirmed is idempotent; calling it on replays covers a crash between steps.
  const { data: now } = await admin.from("bookings").select("status").eq("id", booking.id).single();
  if (now?.status === "confirmed") await onBookingConfirmed(booking.id);
}

async function grantPaymentCredits(
  admin: Admin,
  payment: Payment,
  reason: "purchase" | "subscription_renewal",
  periodEnd?: Date | null,
) {
  if (!payment.offering_id || !payment.client_id) return;
  const { data: offering } = await admin
    .from("offerings")
    .select("credits, credits_expire_days, session_type_ids, name")
    .eq("id", payment.offering_id)
    .maybeSingle();
  if (!offering) return;
  const grant = creditGrantFor(offering, payment.paid_at ? new Date(payment.paid_at) : new Date(), { periodEnd });
  if (!grant) return;
  const { error } = await admin.from("credit_ledger").insert({
    client_id: payment.client_id,
    trainer_id: payment.trainer_id,
    delta: grant.delta,
    reason,
    offering_id: payment.offering_id,
    payment_id: payment.id,
    session_type_ids: grant.session_type_ids,
    expires_at: grant.expires_at,
    note: offering.name,
  });
  // The unique (payment_id) grant index makes replays a no-op.
  if (error && !isUniqueViolation(error)) throw new Error(`credit grant failed: ${error.message}`);
}

async function announcePurchase(admin: Admin, payment: Payment, kind: "package" | "one_time") {
  const [{ data: offering }, { data: client }] = await Promise.all([
    payment.offering_id
      ? admin.from("offerings").select("name, credits, digital_file_path, digital_file_name, credits_expire_days").eq("id", payment.offering_id).maybeSingle()
      : Promise.resolve({ data: null }),
    payment.client_id
      ? admin.from("profiles").select("email, full_name").eq("id", payment.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const name = offering?.name ?? payment.description ?? "your purchase";
  const amount = formatMoney(payment.amount_cents, payment.currency);
  const to = client?.email ?? payment.payer_email;

  await notify({
    userId: payment.trainer_id,
    type: "purchase",
    title: `New purchase: ${name} (${amount})`,
    body: client?.full_name ?? client?.email ?? payment.payer_email ?? undefined,
    link: "/coach/payments",
  });

  if (!to) return;
  if (kind === "package") {
    const credits = offering?.credits ?? 0;
    await sendEmail({
      to,
      subject: `You're all set: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [
        credits
          ? `${credits} session credit${credits === 1 ? "" : "s"} ${credits === 1 ? "has" : "have"} been added to your account${offering?.credits_expire_days ? ` (valid for ${offering.credits_expire_days} days)` : ""}.`
          : `Your purchase of ${name} is confirmed.`,
        "Use them any time you book a session.",
      ],
      cta: { label: "Book a session", url: absoluteUrl("/me/book") },
    });
    return;
  }

  if (offering?.digital_file_path) {
    const url = await signedDownloadUrl(admin, offering.digital_file_path, offering.digital_file_name, 7 * 86_400);
    await sendEmail({
      to,
      subject: `Your download: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [
        `Here's your copy of ${name}. The link below works for 7 days.`,
        "You can download it again any time from Billing in your account.",
      ],
      cta: url ? { label: "Download", url } : { label: "Open my downloads", url: absoluteUrl("/me/billing#downloads") },
    });
  } else {
    await sendEmail({
      to,
      subject: `Purchase confirmed: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [`Your purchase of ${name} (${amount}) is confirmed. Your coach will be in touch with next steps.`],
      cta: { label: "Message your coach", url: absoluteUrl("/me/messages") },
    });
  }
}

// ---------------------------------------------------------------------------
// Subscriptions & invoices
// ---------------------------------------------------------------------------

async function resolveSubscriptionOwner(admin: Admin, sub: Stripe.Subscription) {
  const md = sub.metadata ?? {};
  let clientId = md.client_id || null;
  let offeringId = md.offering_id || null;
  let trainerId = md.trainer_id || null;

  if (!clientId) {
    const customer = idOf(sub.customer);
    if (customer) {
      const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customer).maybeSingle();
      clientId = data?.id ?? null;
    }
  }
  const price = sub.items?.data[0]?.price;
  if (!offeringId && price) {
    const product = idOf(price.product);
    const { data } = await admin
      .from("offerings")
      .select("id")
      .or(product ? `stripe_price_id.eq.${price.id},stripe_product_id.eq.${product}` : `stripe_price_id.eq.${price.id}`)
      .limit(1)
      .maybeSingle();
    offeringId = data?.id ?? null;
  }
  if (!trainerId && offeringId) {
    const { data } = await admin.from("offerings").select("trainer_id").eq("id", offeringId).maybeSingle();
    trainerId = data?.trainer_id ?? null;
  }
  return { clientId, offeringId, trainerId };
}

async function upsertSubscription(admin: Admin, sub: Stripe.Subscription): Promise<Tables<"subscriptions"> | null> {
  const { clientId, offeringId, trainerId } = await resolveSubscriptionOwner(admin, sub);
  if (!clientId || !trainerId) {
    console.warn("[payments] subscription without a known client/trainer", sub.id);
    return null;
  }
  const { data, error } = await admin
    .from("subscriptions")
    .upsert(
      {
        stripe_subscription_id: sub.id,
        client_id: clientId,
        trainer_id: trainerId,
        offering_id: offeringId,
        ...subscriptionRowFromStripe(sub),
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
  return data;
}

async function handleSubscriptionEvent(
  admin: Admin,
  sub: Stripe.Subscription,
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
) {
  // Event payloads can arrive out of order; mirror the latest state from the API.
  let latest = sub;
  if (type !== "customer.subscription.deleted") {
    try {
      latest = await stripe().subscriptions.retrieve(sub.id);
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
  }
  const { data: before } = await admin.from("subscriptions").select("status, cancel_at_period_end").eq("stripe_subscription_id", sub.id).maybeSingle();
  const row = await upsertSubscription(admin, latest);
  if (!row) return;

  if (type === "customer.subscription.created" || (!before && row.status !== "incomplete")) {
    await linkClientToTrainer(admin, row.trainer_id, row.client_id);
  }
  const name = await offeringName(admin, row.offering_id);
  if (type === "customer.subscription.deleted" && before?.status !== "canceled") {
    await notify({ userId: row.trainer_id, type: "subscription_ended", title: `Membership ended: ${name}`, link: "/coach/payments#subscriptions" });
    await notify({
      userId: row.client_id,
      type: "subscription_ended",
      title: `Your ${name} membership has ended`,
      body: "You can rejoin any time from the pricing page.",
      link: "/pricing",
    });
  } else if (before && !before.cancel_at_period_end && row.cancel_at_period_end) {
    await notify({ userId: row.trainer_id, type: "subscription_cancelling", title: `Membership set to cancel: ${name}`, link: "/coach/payments#subscriptions" });
  } else if (!before && (row.status === "active" || row.status === "trialing")) {
    await notify({ userId: row.trainer_id, type: "subscription_started", title: `New member: ${name}`, link: "/coach/payments#subscriptions" });
  }
}

async function offeringName(admin: Admin, offeringId: string | null) {
  if (!offeringId) return "membership";
  const { data } = await admin.from("offerings").select("name").eq("id", offeringId).maybeSingle();
  return data?.name ?? "membership";
}

async function handleInvoice(admin: Admin, invoice: Stripe.Invoice, outcome: "paid" | "failed") {
  // invoice.payments isn't always included in event payloads.
  let inv = invoice;
  if (!inv.payments) inv = await stripe().invoices.retrieve(invoice.id, { expand: ["payments"] });

  const subscriptionId = invoiceSubscriptionId(inv);
  if (subscriptionId) return handleSubscriptionInvoice(admin, inv, subscriptionId, outcome);

  const kind = inv.metadata?.kind;
  const paymentId = inv.metadata?.payment_id;
  if ((kind === "invoice" || kind === "fee") && paymentId) {
    if (outcome === "failed") return; // Hosted-invoice attempts can be retried by the client.
    const fields = paymentFromInvoice(inv, "paid");
    const { data: moved } = await admin
      .from("payments")
      .update({
        status: "succeeded",
        paid_at: fields.paid_at,
        stripe_invoice_id: inv.id,
        stripe_payment_intent_id: fields.stripe_payment_intent_id,
        hosted_invoice_url: fields.hosted_invoice_url,
        amount_cents: fields.amount_cents,
      })
      .eq("id", paymentId)
      .in("status", ["pending", "failed"])
      .select("*");
    const p = moved?.[0];
    if (p?.stripe_payment_intent_id) await enrichFromPaymentIntent(admin, p.id, p.stripe_payment_intent_id);
    if (p) {
      await notify({
        userId: p.trainer_id,
        type: "invoice_paid",
        title: `Invoice paid: ${formatMoney(p.amount_cents, p.currency)}`,
        body: p.description ?? undefined,
        link: "/coach/payments",
      });
    }
  }
}

async function handleSubscriptionInvoice(admin: Admin, inv: Stripe.Invoice, subscriptionId: string, outcome: "paid" | "failed") {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const row = await upsertSubscription(admin, sub);
  if (!row) return;
  const name = await offeringName(admin, row.offering_id);
  const fields = paymentFromInvoice(inv, outcome);

  const { data: existing } = await admin.from("payments").select("*").eq("stripe_invoice_id", inv.id).maybeSingle();
  let payment: Payment | null = existing;
  if (existing) {
    if (existing.status === "pending" || existing.status === "failed") {
      const { data } = await admin
        .from("payments")
        .update({ ...fields, metadata: { ...(existing.metadata as Record<string, Json>), ...fields.metadata } as Json })
        .eq("id", existing.id)
        .select("*")
        .single();
      payment = data;
    }
  } else {
    const { data, error } = await admin
      .from("payments")
      .insert({
        trainer_id: row.trainer_id,
        client_id: row.client_id,
        purpose: "subscription",
        offering_id: row.offering_id,
        subscription_id: row.id,
        description: `${name} membership`,
        ...fields,
        metadata: fields.metadata as Json,
      })
      .select("*")
      .single();
    if (error && !isUniqueViolation(error)) throw new Error(`subscription payment insert failed: ${error.message}`);
    payment = data ?? (await admin.from("payments").select("*").eq("stripe_invoice_id", inv.id).maybeSingle()).data;
  }
  if (!payment) return;

  if (outcome === "paid") {
    if (payment.stripe_payment_intent_id && !payment.receipt_url && payment.amount_cents > 0) {
      await enrichFromPaymentIntent(admin, payment.id, payment.stripe_payment_intent_id);
    }
    await linkClientToTrainer(admin, row.trainer_id, row.client_id);
    if (invoiceGrantsCredits(inv)) {
      const line = inv.lines?.data?.find((l) => l.period?.end);
      const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : row.current_period_end ? new Date(row.current_period_end) : null;
      await grantPaymentCredits(
        admin,
        payment,
        inv.billing_reason === "subscription_create" ? "purchase" : "subscription_renewal",
        periodEnd,
      );
    }
    return;
  }

  // Payment failed: tell both sides (Stripe retries automatically per the dashboard settings).
  const amount = formatMoney(inv.amount_due, inv.currency);
  await notify({
    userId: row.client_id,
    type: "payment_failed",
    title: `Payment failed for your ${name} membership`,
    body: `We couldn't charge ${amount}. Please update your payment method to keep your membership active.`,
    link: "/me/billing",
    email: true,
  });
  await notify({
    userId: row.trainer_id,
    type: "payment_failed",
    title: `Membership payment failed (${amount})`,
    body: `${name}${inv.customer_email ? ` – ${inv.customer_email}` : ""}`,
    link: "/coach/payments#subscriptions",
    email: true,
  });
}

// ---------------------------------------------------------------------------
// Charges & payment intents
// ---------------------------------------------------------------------------

async function findPaymentForCharge(admin: Admin, charge: Stripe.Charge): Promise<Payment | null> {
  const pi = idOf(charge.payment_intent);
  if (pi) {
    const { data } = await admin.from("payments").select("*").eq("stripe_payment_intent_id", pi).maybeSingle();
    if (data) return data;
  }
  const { data } = await admin.from("payments").select("*").eq("stripe_charge_id", charge.id).limit(1).maybeSingle();
  if (data) return data;
  // Checkout payments recorded before the PI id was known.
  if (pi) {
    const sessions = await stripe().checkout.sessions.list({ payment_intent: pi, limit: 1 });
    const sessionId = sessions.data[0]?.id;
    if (sessionId) {
      const { data: bySession } = await admin.from("payments").select("*").eq("stripe_checkout_session_id", sessionId).maybeSingle();
      return bySession;
    }
  }
  return null;
}

async function handleChargeRefunded(admin: Admin, charge: Stripe.Charge) {
  const payment = await findPaymentForCharge(admin, charge);
  if (!payment) return;
  const update = paymentUpdateFromCharge(charge);
  await admin
    .from("payments")
    .update({ ...update, stripe_payment_intent_id: payment.stripe_payment_intent_id ?? idOf(charge.payment_intent) })
    .eq("id", payment.id);
  if (update.amount_refunded_cents > payment.amount_refunded_cents && payment.client_id) {
    await notify({
      userId: payment.client_id,
      type: "refund",
      title: `Refund issued: ${formatMoney(update.amount_refunded_cents - payment.amount_refunded_cents, payment.currency)}`,
      body: payment.description ?? undefined,
      link: "/me/billing",
    });
  }
}

async function handlePaymentIntentFailed(admin: Admin, pi: Stripe.PaymentIntent) {
  const message = pi.last_payment_error?.message ?? "Payment failed";
  const paymentId = pi.metadata?.payment_id;
  let query = admin
    .from("payments")
    .update({ status: "failed", stripe_payment_intent_id: pi.id })
    .eq("status", "pending");
  query = paymentId ? query.eq("id", paymentId) : query.eq("stripe_payment_intent_id", pi.id);
  const { data: rows } = await query.select("id, metadata");
  for (const r of rows ?? []) {
    await admin
      .from("payments")
      .update({ metadata: { ...(r.metadata as Record<string, Json>), failure_code: pi.last_payment_error?.code ?? null, failure_message: message } })
      .eq("id", r.id);
  }
}
