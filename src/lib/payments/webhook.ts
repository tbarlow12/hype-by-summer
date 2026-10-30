import "server-only";
import type Stripe from "stripe";
import { stripe, onAccount } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/lib/format";
import { brandOf, businessUrl } from "@/lib/tenant";
import { onBookingConfirmed } from "@/lib/scheduling/lifecycle";
import { applyAccountStatus, disconnectAccount } from "@/lib/payments/accounts";
import { rememberStripeCustomer } from "@/lib/payments/customers";
import {
  checkoutKind,
  creditGrantFor,
  idOf,
  invoiceGrantsCredits,
  invoiceSubscriptionId,
  netPlatformFeeCents,
  paymentFromInvoice,
  paymentUpdateFromCharge,
  paymentUpdateFromCheckout,
  platformFeeRow,
  subscriptionRowFromStripe,
} from "@/lib/payments/mapping";
import {
  handlePlatformCheckout,
  handlePlatformInvoice,
  handlePlatformSubscription,
} from "@/lib/payments/platform-billing";
import { refundPayment } from "@/lib/payments/refunds";
import { CONNECT_EVENTS, PLATFORM_EVENTS, routeEvent } from "@/lib/payments/routing";
import {
  attributeCoach,
  isMissing,
  isUniqueViolation,
  linkClientToBusiness,
  moneyRecipients,
  signedDownloadUrl,
  type Admin,
  type Business,
} from "@/lib/payments/shared";
import type { Json, Tables, TablesInsert } from "@/lib/supabase/database.types";

type Payment = Tables<"payments">;
type CheckoutOutcome = "completed" | "async_succeeded" | "async_failed" | "expired";

/** Everything the endpoint acts on, per Stripe webhook endpoint. */
export const HANDLED_EVENTS = { platform: PLATFORM_EVENTS, connect: CONNECT_EVENTS } as const;

/** A Connect event's business and the options that scope API calls to its account. */
type Ctx = { admin: Admin; business: Business; account: string; opts: Stripe.RequestOptions };

// ---------------------------------------------------------------------------
// Idempotent entry point
// ---------------------------------------------------------------------------

/**
 * Records the event in stripe_events first (with the connected account),
 * skips it if it was already processed, otherwise handles it and stores the
 * outcome. Throws on handler errors so the route returns 500 and Stripe
 * retries.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<"processed" | "skipped"> {
  const admin = createAdminClient();
  const { error: insertErr } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, account: event.account ?? null, payload: event as unknown as Json });
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
  const route = routeEvent(event);
  if (route.scope === "platform") return handlePlatformEvent(admin, event);

  const { data: business } = await admin.from("businesses").select("*").eq("stripe_account_id", route.account).maybeSingle();
  if (!business) {
    console.warn("[stripe-webhook] event for an unknown connected account", event.type, route.account);
    return;
  }
  return handleConnectEvent({ admin, business, account: route.account, opts: onAccount(route.account) }, event);
}

async function handlePlatformEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handlePlatformCheckout(admin, event.data.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handlePlatformSubscription(admin, event.data.object, event.type === "customer.subscription.deleted");
    case "invoice.paid":
      return handlePlatformInvoice(admin, event.data.object, "paid");
    case "invoice.payment_failed":
      return handlePlatformInvoice(admin, event.data.object, "failed");
    case "application_fee.created":
    case "application_fee.refunded":
      return handleApplicationFee(admin, event.data.object);
    default:
      return;
  }
}

async function handleConnectEvent(ctx: Ctx, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "account.updated":
      await applyAccountStatus(ctx.admin, event.data.object);
      return;
    case "account.application.deauthorized":
      await disconnectAccount(ctx.admin, ctx.account);
      return;
    case "checkout.session.completed":
      return handleCheckoutSession(ctx, event.data.object, "completed");
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutSession(ctx, event.data.object, "async_succeeded");
    case "checkout.session.async_payment_failed":
      return handleCheckoutSession(ctx, event.data.object, "async_failed");
    case "checkout.session.expired":
      return handleCheckoutSession(ctx, event.data.object, "expired");
    case "invoice.paid":
      return handleInvoice(ctx, event.data.object, "paid");
    case "invoice.payment_failed":
      return handleInvoice(ctx, event.data.object, "failed");
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionEvent(ctx, event.data.object, event.type);
    case "charge.refunded":
      return handleChargeRefunded(ctx, event.data.object);
    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(ctx, event.data.object);
    default:
      return;
  }
}

async function notifyStaff(ctx: Ctx, coachId: string | null, n: { type: string; title: string; body?: string; link: string; email?: boolean }) {
  for (const userId of await moneyRecipients(ctx.admin, ctx.business.id, coachId)) {
    await notify({ userId, businessId: ctx.business.id, ...n });
  }
}

// ---------------------------------------------------------------------------
// Platform application fees
// ---------------------------------------------------------------------------

/** application_fee.created / .refunded: record the fee and put it on the payment it came from. */
async function handleApplicationFee(admin: Admin, fee: Stripe.ApplicationFee): Promise<void> {
  const account = idOf(fee.account);
  if (!account) return;
  const { data: business } = await admin.from("businesses").select("id").eq("stripe_account_id", account).maybeSingle();
  const row = platformFeeRow(fee, business?.id ?? null);
  const { error } = await admin.from("platform_fees").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`platform_fees upsert failed: ${error.message}`);

  // For direct charges, fee.charge is the charge on the connected account.
  const chargeId = idOf(fee.charge);
  if (!chargeId) return;
  let payment: Pick<Payment, "id" | "stripe_charge_id"> | null = null;
  const { data: byCharge } = await admin
    .from("payments")
    .select("id, stripe_charge_id")
    .eq("stripe_charge_id", chargeId)
    .limit(1)
    .maybeSingle();
  payment = byCharge;
  if (!payment) {
    try {
      const charge = await stripe().charges.retrieve(chargeId, {}, onAccount(account));
      const pi = idOf(charge.payment_intent);
      if (pi) {
        const { data } = await admin.from("payments").select("id, stripe_charge_id").eq("stripe_payment_intent_id", pi).maybeSingle();
        payment = data;
      }
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  // Not recorded yet: the payment picks the fee up from its charge when it's fulfilled.
  if (!payment) return;
  await admin
    .from("payments")
    .update({ platform_fee_cents: netPlatformFeeCents(fee), ...(payment.stripe_charge_id ? {} : { stripe_charge_id: chargeId }) })
    .eq("id", payment.id);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Fulfil a Checkout Session on a business's account. Safe to call repeatedly
 * and from both the webhook and the success page.
 */
export async function fulfillCheckoutSession(business: Business, session: Stripe.Checkout.Session): Promise<void> {
  if (!business.stripe_account_id) return;
  const account = business.stripe_account_id;
  await handleCheckoutSession({ admin: createAdminClient(), business, account, opts: onAccount(account) }, session, "completed");
}

async function handleCheckoutSession(ctx: Ctx, session: Stripe.Checkout.Session, outcome: CheckoutOutcome) {
  const kind = checkoutKind(session);
  if (!kind) return;
  // Sessions we create always carry the business; never act on another's.
  if (session.metadata?.business_id && session.metadata.business_id !== ctx.business.id) return;

  if (kind === "subscription") {
    if (outcome === "completed" && session.subscription) {
      const sub = await stripe().subscriptions.retrieve(idOf(session.subscription)!, {}, ctx.opts);
      const row = await upsertSubscription(ctx, sub);
      if (row) await linkClientToBusiness(ctx.admin, ctx.business.id, row.client_id);
    }
    return;
  }

  const { payment, transitioned } = await applyCheckoutPayment(ctx, session, kind, outcome);
  if (!payment) return;
  if (payment.status === "succeeded" && payment.stripe_payment_intent_id && !payment.receipt_url) {
    await enrichFromPaymentIntent(ctx, payment.id, payment.stripe_payment_intent_id);
  }
  // Guest checkouts create a customer; remember it on the client relationship.
  const customer = idOf(session.customer);
  if (customer && payment.client_id) await rememberStripeCustomer(ctx.admin, ctx.business.id, payment.client_id, customer);

  if (kind === "booking") return handleBookingCheckout(ctx, session, payment, outcome);
  if (payment.status !== "succeeded") return;

  await linkClientToBusiness(ctx.admin, ctx.business.id, payment.client_id);
  if (kind === "package") await grantPaymentCredits(ctx.admin, payment, "purchase");
  if (transitioned) await announcePurchase(ctx, payment, kind);
}

/** Move the checkout's payment row to its new state (insert if missing). */
async function applyCheckoutPayment(
  ctx: Ctx,
  session: Stripe.Checkout.Session,
  kind: "booking" | "package" | "one_time",
  outcome: CheckoutOutcome,
): Promise<{ payment: Payment | null; transitioned: boolean }> {
  const { admin, business } = ctx;
  const update = paymentUpdateFromCheckout(session, outcome);
  // Only pending (or a failed async attempt) may move; never clobber refunds.
  const fromStatuses = outcome === "expired" ? ["pending"] : ["pending", "failed"];
  const { data: moved, error } = await admin
    .from("payments")
    .update(update)
    .eq("business_id", business.id)
    .eq("stripe_checkout_session_id", session.id)
    .in("status", fromStatuses as Payment["status"][])
    .select("*");
  if (error) throw new Error(`payments update failed: ${error.message}`);
  if (moved && moved.length) return { payment: moved[0]!, transitioned: update.status === "succeeded" };

  const { data: existing } = await admin
    .from("payments")
    .select("*")
    .eq("business_id", business.id)
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (existing) return { payment: existing, transitioned: false };
  if (outcome === "expired") return { payment: null, transitioned: false };

  // Row missing (created outside our flow or the insert failed): create it.
  const md = session.metadata ?? {};
  let description: string | null = null;
  let offeringId: string | null = null;
  if (md.offering_id) {
    const { data: o } = await admin.from("offerings").select("id, name").eq("id", md.offering_id).eq("business_id", business.id).maybeSingle();
    description = o?.name ?? null;
    offeringId = o?.id ?? null;
  }
  let bookingId: string | null = null;
  if (md.booking_id) {
    const { data: b } = await admin.from("bookings").select("id").eq("id", md.booking_id).eq("business_id", business.id).maybeSingle();
    bookingId = b?.id ?? null;
  }
  const clientId = md.client_id || null;
  const insert: TablesInsert<"payments"> = {
    business_id: business.id,
    client_id: clientId,
    coach_id: (await attributeCoach(admin, business.id, { bookingId, clientId })) ?? null,
    purpose: kind,
    amount_cents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    description,
    booking_id: bookingId,
    offering_id: offeringId,
    stripe_account_id: ctx.account,
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

/** Receipt, charge id and the platform fee from the payment's charge. */
async function enrichFromPaymentIntent(ctx: Ctx, paymentId: string, paymentIntentId: string) {
  try {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] }, ctx.opts);
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (!charge) return;
    const update: Partial<Payment> = { stripe_charge_id: charge.id, receipt_url: charge.receipt_url };
    if (charge.application_fee_amount != null) {
      // Prefer the recorded fee (it knows about fee refunds).
      const { data: fee } = await ctx.admin
        .from("platform_fees")
        .select("amount_cents, amount_refunded_cents")
        .eq("charge_id", charge.id)
        .maybeSingle();
      update.platform_fee_cents = fee ? Math.max(0, fee.amount_cents - fee.amount_refunded_cents) : charge.application_fee_amount;
    }
    await ctx.admin.from("payments").update(update).eq("id", paymentId);
  } catch (err) {
    // Receipts are nice-to-have; never fail the event over them.
    console.error("[payments] receipt lookup failed", err);
  }
}

async function handleBookingCheckout(ctx: Ctx, session: Stripe.Checkout.Session, payment: Payment, outcome: CheckoutOutcome) {
  const { admin, business } = ctx;
  const bookingId = payment.booking_id ?? session.metadata?.booking_id;
  if (!bookingId) return;
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status, cancel_reason, client_id, coach_id, guest_email, hold_expires_at, stripe_checkout_session_id")
    .eq("id", bookingId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!booking) return;

  if (outcome === "expired" || outcome === "async_failed") {
    // A superseded session (the client restarted checkout) must not cancel the booking.
    if (booking.stripe_checkout_session_id && booking.stripe_checkout_session_id !== session.id) return;
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
        businessId: business.id,
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
    await refundPayment(payment.id, { reason: "Paid after the booking hold expired", businessId: business.id }, admin);
    await notifyStaff(ctx, booking.coach_id, {
      type: "payment_refunded",
      title: "Late payment refunded",
      body: "A client paid after their booking hold expired, so the payment was refunded automatically.",
      link: "/coach/payments",
    });
    if (booking.client_id) {
      await notify({
        userId: booking.client_id,
        businessId: business.id,
        type: "payment_refunded",
        title: "Your payment was refunded",
        body: "Your hold on that time slot expired before the payment completed, so we refunded you in full. Please pick a new time.",
        link: "/me/book",
        email: true,
      });
    } else if (booking.guest_email) {
      await sendEmail({
        brand: brandOf(business),
        to: booking.guest_email,
        subject: "Your payment was refunded",
        heading: "Your payment was refunded",
        paragraphs: [
          "Your hold on that time slot expired before the payment completed, so we refunded you in full.",
          "Please pick a new time on the booking page.",
        ],
        cta: { label: "Book again", url: businessUrl(business, "/book") },
      });
    }
    return;
  }

  await linkClientToBusiness(admin, business.id, booking.client_id);
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
    .eq("business_id", payment.business_id)
    .maybeSingle();
  if (!offering) return;
  const grant = creditGrantFor(offering, payment.paid_at ? new Date(payment.paid_at) : new Date(), { periodEnd });
  if (!grant) return;
  const { error } = await admin.from("credit_ledger").insert({
    business_id: payment.business_id,
    client_id: payment.client_id,
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

async function announcePurchase(ctx: Ctx, payment: Payment, kind: "package" | "one_time") {
  const { admin, business } = ctx;
  const brand = brandOf(business);
  const [{ data: offering }, { data: client }] = await Promise.all([
    payment.offering_id
      ? admin
          .from("offerings")
          .select("name, credits, digital_file_path, digital_file_name, credits_expire_days")
          .eq("id", payment.offering_id)
          .eq("business_id", business.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    payment.client_id
      ? admin.from("profiles").select("email, full_name").eq("id", payment.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const name = offering?.name ?? payment.description ?? "your purchase";
  const amount = formatMoney(payment.amount_cents, payment.currency);
  const to = client?.email ?? payment.payer_email;

  await notifyStaff(ctx, payment.coach_id, {
    type: "purchase",
    title: `New purchase: ${name} (${amount})`,
    body: client?.full_name ?? client?.email ?? payment.payer_email ?? undefined,
    link: "/coach/payments",
  });

  if (!to) return;
  if (kind === "package") {
    const credits = offering?.credits ?? 0;
    await sendEmail({
      brand,
      to,
      subject: `You're all set: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [
        credits
          ? `${credits} session credit${credits === 1 ? "" : "s"} ${credits === 1 ? "has" : "have"} been added to your account${offering?.credits_expire_days ? ` (valid for ${offering.credits_expire_days} days)` : ""}.`
          : `Your purchase of ${name} is confirmed.`,
        "Use them any time you book a session.",
      ],
      cta: { label: "Book a session", url: businessUrl(business, "/me/book") },
    });
    return;
  }

  if (offering?.digital_file_path) {
    const url = await signedDownloadUrl(admin, offering.digital_file_path, offering.digital_file_name, 7 * 86_400);
    await sendEmail({
      brand,
      to,
      subject: `Your download: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [
        `Here's your copy of ${name}. The link below works for 7 days.`,
        "You can download it again any time from Billing in your account.",
      ],
      cta: url ? { label: "Download", url } : { label: "Open my downloads", url: businessUrl(business, "/me/billing#downloads") },
    });
  } else {
    await sendEmail({
      brand,
      to,
      subject: `Purchase confirmed: ${name}`,
      heading: "Thanks for your purchase!",
      paragraphs: [`Your purchase of ${name} (${amount}) is confirmed. Your coach will be in touch with next steps.`],
      cta: { label: "Message your coach", url: businessUrl(business, "/me/messages") },
    });
  }
}

// ---------------------------------------------------------------------------
// Subscriptions & invoices
// ---------------------------------------------------------------------------

async function resolveSubscriptionOwner(ctx: Ctx, sub: Stripe.Subscription) {
  const { admin, business } = ctx;
  const md = sub.metadata ?? {};
  let clientId = md.client_id || null;
  let offeringId: string | null = null;

  if (!clientId) {
    const customer = idOf(sub.customer);
    if (customer) {
      const { data } = await admin
        .from("business_clients")
        .select("client_id")
        .eq("business_id", business.id)
        .eq("stripe_customer_id", customer)
        .maybeSingle();
      clientId = data?.client_id ?? null;
    }
  }
  if (md.offering_id) {
    const { data } = await admin.from("offerings").select("id").eq("id", md.offering_id).eq("business_id", business.id).maybeSingle();
    offeringId = data?.id ?? null;
  }
  const price = sub.items?.data[0]?.price;
  if (!offeringId && price) {
    const product = idOf(price.product);
    const { data } = await admin
      .from("offerings")
      .select("id")
      .eq("business_id", business.id)
      .or(product ? `stripe_price_id.eq.${price.id},stripe_product_id.eq.${product}` : `stripe_price_id.eq.${price.id}`)
      .limit(1)
      .maybeSingle();
    offeringId = data?.id ?? null;
  }
  return { clientId, offeringId, metaCoachId: md.coach_id || null };
}

async function upsertSubscription(ctx: Ctx, sub: Stripe.Subscription): Promise<Tables<"subscriptions"> | null> {
  const { admin, business } = ctx;
  const { clientId, offeringId, metaCoachId } = await resolveSubscriptionOwner(ctx, sub);
  if (!clientId) {
    console.warn("[payments] subscription without a known client", business.id, sub.id);
    return null;
  }
  const { data: before } = await admin.from("subscriptions").select("coach_id").eq("stripe_subscription_id", sub.id).maybeSingle();
  const coachId = before?.coach_id ?? metaCoachId ?? (await attributeCoach(admin, business.id, { clientId }));
  const { data, error } = await admin
    .from("subscriptions")
    .upsert(
      {
        stripe_subscription_id: sub.id,
        business_id: business.id,
        client_id: clientId,
        coach_id: coachId,
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
  ctx: Ctx,
  sub: Stripe.Subscription,
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
) {
  const { admin, business } = ctx;
  // Event payloads can arrive out of order; mirror the latest state from the API.
  let latest = sub;
  if (type !== "customer.subscription.deleted") {
    try {
      latest = await stripe().subscriptions.retrieve(sub.id, {}, ctx.opts);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  const { data: before } = await admin
    .from("subscriptions")
    .select("status, cancel_at_period_end")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  const row = await upsertSubscription(ctx, latest);
  if (!row) return;

  if (type === "customer.subscription.created" || (!before && row.status !== "incomplete")) {
    await linkClientToBusiness(admin, business.id, row.client_id);
  }
  const name = await offeringName(admin, row.offering_id);
  if (type === "customer.subscription.deleted" && before?.status !== "canceled") {
    await notifyStaff(ctx, row.coach_id, { type: "subscription_ended", title: `Membership ended: ${name}`, link: "/coach/payments#subscriptions" });
    await notify({
      userId: row.client_id,
      businessId: business.id,
      type: "subscription_ended",
      title: `Your ${name} membership has ended`,
      body: "You can rejoin any time from the pricing page.",
      link: "/pricing",
    });
  } else if (before && !before.cancel_at_period_end && row.cancel_at_period_end) {
    await notifyStaff(ctx, row.coach_id, { type: "subscription_cancelling", title: `Membership set to cancel: ${name}`, link: "/coach/payments#subscriptions" });
  } else if (!before && (row.status === "active" || row.status === "trialing")) {
    await notifyStaff(ctx, row.coach_id, { type: "subscription_started", title: `New member: ${name}`, link: "/coach/payments#subscriptions" });
  }
}

async function offeringName(admin: Admin, offeringId: string | null) {
  if (!offeringId) return "membership";
  const { data } = await admin.from("offerings").select("name").eq("id", offeringId).maybeSingle();
  return data?.name ?? "membership";
}

async function handleInvoice(ctx: Ctx, invoice: Stripe.Invoice, outcome: "paid" | "failed") {
  const { admin, business } = ctx;
  // invoice.payments isn't always included in event payloads.
  let inv = invoice;
  if (!inv.payments) inv = await stripe().invoices.retrieve(invoice.id, { expand: ["payments"] }, ctx.opts);

  const subscriptionId = invoiceSubscriptionId(inv);
  if (subscriptionId) return handleSubscriptionInvoice(ctx, inv, subscriptionId, outcome);

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
      .eq("business_id", business.id)
      .in("status", ["pending", "failed"])
      .select("*");
    const p = moved?.[0];
    if (p?.stripe_payment_intent_id) await enrichFromPaymentIntent(ctx, p.id, p.stripe_payment_intent_id);
    if (p) {
      await notifyStaff(ctx, p.coach_id, {
        type: "invoice_paid",
        title: `Invoice paid: ${formatMoney(p.amount_cents, p.currency)}`,
        body: p.description ?? undefined,
        link: "/coach/payments",
      });
    }
  }
}

async function handleSubscriptionInvoice(ctx: Ctx, inv: Stripe.Invoice, subscriptionId: string, outcome: "paid" | "failed") {
  const { admin, business } = ctx;
  const sub = await stripe().subscriptions.retrieve(subscriptionId, {}, ctx.opts);
  const row = await upsertSubscription(ctx, sub);
  if (!row) return;
  const name = await offeringName(admin, row.offering_id);
  const fields = paymentFromInvoice(inv, outcome);

  const { data: existing } = await admin.from("payments").select("*").eq("stripe_invoice_id", inv.id).eq("business_id", business.id).maybeSingle();
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
        business_id: business.id,
        client_id: row.client_id,
        coach_id: row.coach_id,
        purpose: "subscription",
        offering_id: row.offering_id,
        subscription_id: row.id,
        description: `${name} membership`,
        stripe_account_id: ctx.account,
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
      await enrichFromPaymentIntent(ctx, payment.id, payment.stripe_payment_intent_id);
    }
    await linkClientToBusiness(admin, business.id, row.client_id);
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

  // Payment failed: tell both sides (Stripe retries automatically per the account's settings).
  const amount = formatMoney(inv.amount_due, inv.currency);
  await notify({
    userId: row.client_id,
    businessId: business.id,
    type: "payment_failed",
    title: `Payment failed for your ${name} membership`,
    body: `We couldn't charge ${amount}. Please update your payment method to keep your membership active.`,
    link: "/me/billing",
    email: true,
  });
  await notifyStaff(ctx, row.coach_id, {
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

async function findPaymentForCharge(ctx: Ctx, charge: Stripe.Charge): Promise<Payment | null> {
  const { admin, business } = ctx;
  const pi = idOf(charge.payment_intent);
  if (pi) {
    const { data } = await admin.from("payments").select("*").eq("business_id", business.id).eq("stripe_payment_intent_id", pi).maybeSingle();
    if (data) return data;
  }
  const { data } = await admin.from("payments").select("*").eq("business_id", business.id).eq("stripe_charge_id", charge.id).limit(1).maybeSingle();
  if (data) return data;
  // Checkout payments recorded before the PI id was known.
  if (pi) {
    const sessions = await stripe().checkout.sessions.list({ payment_intent: pi, limit: 1 }, ctx.opts);
    const sessionId = sessions.data[0]?.id;
    if (sessionId) {
      const { data: bySession } = await admin
        .from("payments")
        .select("*")
        .eq("business_id", business.id)
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      return bySession;
    }
  }
  return null;
}

async function handleChargeRefunded(ctx: Ctx, charge: Stripe.Charge) {
  const payment = await findPaymentForCharge(ctx, charge);
  if (!payment) return;
  const update = paymentUpdateFromCharge(charge);
  await ctx.admin
    .from("payments")
    .update({ ...update, stripe_payment_intent_id: payment.stripe_payment_intent_id ?? idOf(charge.payment_intent) })
    .eq("id", payment.id);
  if (update.amount_refunded_cents > payment.amount_refunded_cents && payment.client_id) {
    await notify({
      userId: payment.client_id,
      businessId: ctx.business.id,
      type: "refund",
      title: `Refund issued: ${formatMoney(update.amount_refunded_cents - payment.amount_refunded_cents, payment.currency)}`,
      body: payment.description ?? undefined,
      link: "/me/billing",
    });
  }
}

async function handlePaymentIntentFailed(ctx: Ctx, pi: Stripe.PaymentIntent) {
  const message = pi.last_payment_error?.message ?? "Payment failed";
  const paymentId = pi.metadata?.payment_id;
  let query = ctx.admin
    .from("payments")
    .update({ status: "failed", stripe_payment_intent_id: pi.id })
    .eq("business_id", ctx.business.id)
    .eq("status", "pending");
  query = paymentId ? query.eq("id", paymentId) : query.eq("stripe_payment_intent_id", pi.id);
  const { data: rows } = await query.select("id, metadata");
  for (const r of rows ?? []) {
    await ctx.admin
      .from("payments")
      .update({ metadata: { ...(r.metadata as Record<string, Json>), failure_code: pi.last_payment_error?.code ?? null, failure_message: message } })
      .eq("id", r.id);
  }
}
