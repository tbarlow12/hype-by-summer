import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";
import { notify } from "@/lib/notify";
import { createClientInvoice } from "@/lib/payments/invoices";
import { applicationFeeAmount } from "@/lib/payments/fees";
import { bookingFeeCents, feeFailureMessage, idOf, invoicePaymentIntentId, refundStatus, refundableCents } from "@/lib/payments/mapping";
import { attributeCoach, chargeAccount, loadBusiness, PaymentsUnavailableError, type Admin } from "@/lib/payments/shared";
import type { Json, Tables } from "@/lib/supabase/database.types";

// OWNER: payments. Contract used by scheduling (cancellations / no-shows).
// Refunds and fees act on the connected account the payment was made on.

type Payment = Tables<"payments">;

/** Connected account a payment lives on (recorded on the row; else the business's current one). */
async function accountForPayment(admin: Admin, p: Payment): Promise<Stripe.RequestOptions> {
  if (p.stripe_account_id) return { stripeAccount: p.stripe_account_id };
  const business = await loadBusiness(admin, p.business_id);
  if (!business.stripe_account_id) throw new PaymentsUnavailableError("This payment has no Stripe account to refund on.");
  return { stripeAccount: business.stripe_account_id };
}

async function paymentIntentFor(p: Payment, opts: Stripe.RequestOptions): Promise<string | null> {
  if (p.stripe_payment_intent_id) return p.stripe_payment_intent_id;
  const s = stripe();
  if (p.stripe_checkout_session_id) {
    const session = await s.checkout.sessions.retrieve(p.stripe_checkout_session_id, {}, opts);
    const pi = idOf(session.payment_intent);
    if (pi) return pi;
  }
  if (p.stripe_invoice_id) {
    const invoice = await s.invoices.retrieve(p.stripe_invoice_id, { expand: ["payments"] }, opts);
    return invoicePaymentIntentId(invoice);
  }
  return null;
}

/**
 * Refund (part of) a payment through Stripe and update our row right away
 * (charge.refunded later re-syncs the authoritative totals). The platform's
 * application fee is refunded proportionally. Optionally claws back unused
 * credits granted by that payment.
 */
export async function refundPayment(
  paymentId: string,
  opts: { amountCents?: number; reason?: string; revokeCredits?: boolean; actorId?: string; businessId?: string } = {},
  admin: Admin = createAdminClient(),
): Promise<{ refundedCents: number }> {
  let query = admin.from("payments").select("*").eq("id", paymentId);
  if (opts.businessId) query = query.eq("business_id", opts.businessId);
  const { data: p } = await query.single();
  if (!p) throw new Error("Payment not found");
  const available = refundableCents(p);
  if (available <= 0) return { refundedCents: 0 };
  const amount = Math.min(available, opts.amountCents ?? available);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Refund amount must be positive");

  const reqOpts = await accountForPayment(admin, p);
  const paymentIntent = await paymentIntentFor(p, reqOpts);
  if (!paymentIntent && !p.stripe_charge_id) throw new Error("This payment has no Stripe charge to refund");

  const refund = await stripe().refunds.create(
    {
      ...(paymentIntent ? { payment_intent: paymentIntent } : { charge: p.stripe_charge_id! }),
      amount,
      reason: "requested_by_customer",
      // Starter plan: give the business back the platform's cut on the refunded part.
      // (No-op on charges without an application fee.)
      refund_application_fee: true,
      metadata: { payment_id: p.id, ...(opts.reason ? { note: opts.reason.slice(0, 450) } : {}) },
    },
    { ...reqOpts, idempotencyKey: `refund:${p.id}:${p.amount_refunded_cents}:${amount}` },
  );
  if (refund.status === "failed" || refund.status === "canceled") throw new Error("Stripe could not process the refund");

  const refunded = p.amount_refunded_cents + amount;
  await admin
    .from("payments")
    .update({
      amount_refunded_cents: refunded,
      status: refundStatus(p.amount_cents, refunded),
      stripe_payment_intent_id: p.stripe_payment_intent_id ?? paymentIntent,
      metadata: { ...(p.metadata as Record<string, Json>), last_refund_id: refund.id, ...(opts.reason ? { refund_reason: opts.reason } : {}) },
    })
    .eq("id", p.id);

  if (opts.revokeCredits && p.client_id) {
    // debit_credits removes at most what is left on this payment's grants.
    const { data: own } = await admin.from("credit_ledger").select("delta").eq("payment_id", p.id).gt("delta", 0);
    const granted = (own ?? []).reduce((sum, g) => sum + g.delta, 0);
    if (granted > 0) {
      await admin.rpc("debit_credits", {
        p_client: p.client_id,
        p_business: p.business_id,
        p_amount: granted,
        p_reason: "refund",
        p_note: "Purchase refunded",
        p_created_by: opts.actorId ?? null,
        p_payment: p.id,
      });
    }
  }
  return { refundedCents: amount };
}

/** Refund the Stripe payment attached to a booking (full by default). No-op if none. */
export async function refundBookingPayment(
  bookingId: string,
  opts?: { amountCents?: number; reason?: string },
): Promise<{ refundedCents: number }> {
  const admin = createAdminClient();
  const { data: payments } = await admin
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .eq("purpose", "booking")
    .in("status", ["succeeded", "partially_refunded"])
    .order("created_at", { ascending: false });
  let left = opts?.amountCents;
  let total = 0;
  for (const p of payments ?? []) {
    if (left !== undefined && left <= 0) break;
    const { refundedCents } = await refundPayment(p.id, { amountCents: left, reason: opts?.reason ?? "Booking cancelled" }, admin);
    total += refundedCents;
    if (left !== undefined) left -= refundedCents;
  }
  return { refundedCents: total };
}

/** Customer + card on the connected account to charge off-session for a booking. */
async function savedCardFor(
  admin: Admin,
  booking: Pick<Tables<"bookings">, "id" | "client_id" | "business_id">,
  opts: Stripe.RequestOptions,
): Promise<{ customer: string; paymentMethod: string } | null> {
  const s = stripe();
  let customer: string | null = null;
  let bookingCard: string | null = null;

  // The card used to pay for this booking was saved with setup_future_usage.
  const { data: paid } = await admin
    .from("payments")
    .select("stripe_payment_intent_id, stripe_account_id")
    .eq("booking_id", booking.id)
    .eq("purpose", "booking")
    .not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paid?.stripe_payment_intent_id && (!paid.stripe_account_id || paid.stripe_account_id === opts.stripeAccount)) {
    try {
      const pi = await s.paymentIntents.retrieve(paid.stripe_payment_intent_id, {}, opts);
      customer = idOf(pi.customer);
      bookingCard = idOf(pi.payment_method);
    } catch (err) {
      console.error("[payments] could not load booking payment intent", err);
    }
  }
  if (!customer && booking.client_id) {
    const { data: rel } = await admin
      .from("business_clients")
      .select("stripe_customer_id")
      .eq("business_id", booking.business_id)
      .eq("client_id", booking.client_id)
      .maybeSingle();
    customer = rel?.stripe_customer_id ?? null;
  }
  if (!customer) return null;

  const c = await s.customers.retrieve(customer, {}, opts);
  if ("deleted" in c && c.deleted) return null;
  const defaultPm = idOf((c as Stripe.Customer).invoice_settings?.default_payment_method ?? null);
  if (defaultPm) return { customer, paymentMethod: defaultPm };

  const cards = await s.customers.listPaymentMethods(customer, { type: "card", limit: 10 }, opts);
  const attached = new Set(cards.data.map((pm) => pm.id));
  if (bookingCard && attached.has(bookingCard)) return { customer, paymentMethod: bookingCard };
  const newest = [...cards.data].sort((a, b) => b.created - a.created)[0];
  return newest ? { customer, paymentMethod: newest.id } : null;
}

/**
 * Charge the business's late-cancel or no-show fee to the client's saved card
 * (off-session, on the connected account). Records a `fee` payment
 * attributed to the booking's coach. Returns ok=false with a reason when
 * there is no fee configured or no saved payment method.
 */
export async function chargeBookingFee(
  bookingId: string,
  kind: "late_cancel" | "no_show",
): Promise<{ ok: boolean; error?: string; amountCents?: number }> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, business_id, coach_id, client_id, guest_email, starts_at, session_types(name, currency)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found" };
  const business = await loadBusiness(admin, booking.business_id);
  const amount = bookingFeeCents(business, kind);
  if (amount <= 0) return { ok: false, error: "No fee is configured for this." };
  if (amount < 50) return { ok: false, error: "Fees under $0.50 can't be charged by card." };
  let account: string;
  let reqOpts: Stripe.RequestOptions;
  try {
    ({ account, opts: reqOpts } = chargeAccount(business));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Online payments aren't set up." };
  }

  // Never double-charge the same fee.
  const { data: prior } = await admin
    .from("payments")
    .select("id, status, amount_cents")
    .eq("booking_id", booking.id)
    .eq("purpose", "fee")
    .eq("metadata->>fee_kind", kind)
    .in("status", ["succeeded", "pending", "partially_refunded", "refunded"])
    .limit(1)
    .maybeSingle();
  if (prior) {
    return prior.status === "pending"
      ? { ok: false, error: "This fee is already awaiting payment.", amountCents: prior.amount_cents }
      : { ok: true, amountCents: prior.amount_cents };
  }

  const label = kind === "late_cancel" ? "Late cancellation fee" : "No-show fee";
  const currency = (booking.session_types?.currency ?? "usd").toLowerCase();
  const description = `${label} – ${booking.session_types?.name ?? "session"} on ${new Date(booking.starts_at).toISOString().slice(0, 10)}`;
  const coachId = booking.coach_id ?? (await attributeCoach(admin, business.id, { clientId: booking.client_id }));

  let card: Awaited<ReturnType<typeof savedCardFor>> = null;
  try {
    card = await savedCardFor(admin, booking, reqOpts);
  } catch (err) {
    console.error("[payments] saved card lookup failed", err);
  }
  if (!card) {
    if (booking.client_id) return invoiceFallback(booking, coachId, amount, description, kind, "There's no saved card on file.");
    return { ok: false, error: "There's no saved card on file for this guest." };
  }

  const { data: payment, error: insErr } = await admin
    .from("payments")
    .insert({
      business_id: business.id,
      client_id: booking.client_id,
      coach_id: coachId,
      payer_email: booking.guest_email,
      purpose: "fee",
      status: "pending",
      amount_cents: amount,
      currency,
      description,
      booking_id: booking.id,
      stripe_account_id: account,
      metadata: { fee_kind: kind },
    })
    .select("id")
    .single();
  if (insErr || !payment) return { ok: false, error: "Could not record the fee." };

  const appFee = applicationFeeAmount(amount, business);
  try {
    const pi = await stripe().paymentIntents.create(
      {
        amount,
        currency,
        customer: card.customer,
        payment_method: card.paymentMethod,
        off_session: true,
        confirm: true,
        description,
        ...(appFee ? { application_fee_amount: appFee } : {}),
        metadata: { kind: "fee", fee_kind: kind, booking_id: booking.id, payment_id: payment.id, business_id: business.id, coach_id: coachId ?? "" },
        expand: ["latest_charge"],
      },
      { ...reqOpts, idempotencyKey: `fee:${payment.id}` },
    );
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (pi.status === "succeeded") {
      await admin
        .from("payments")
        .update({
          status: "succeeded",
          stripe_payment_intent_id: pi.id,
          stripe_charge_id: charge?.id ?? null,
          receipt_url: charge?.receipt_url ?? null,
          paid_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      if (booking.client_id) {
        await notify({
          userId: booking.client_id,
          businessId: business.id,
          type: "fee_charged",
          title: `${label} charged: ${formatMoney(amount, currency)}`,
          body: "Per the cancellation policy, this fee was charged to your saved card.",
          link: "/me/billing",
          email: true,
        });
      }
      return { ok: true, amountCents: amount };
    }
    // Processing (e.g. bank debits) – the webhook finishes it.
    await admin.from("payments").update({ stripe_payment_intent_id: pi.id }).eq("id", payment.id);
    return { ok: true, amountCents: amount };
  } catch (err) {
    const e = err as { type?: string; code?: string; decline_code?: string; message?: string; payment_intent?: { id: string } };
    const reason = feeFailureMessage(e);
    await admin
      .from("payments")
      .update({
        status: "failed",
        stripe_payment_intent_id: e.payment_intent?.id ?? null,
        metadata: { fee_kind: kind, failure_code: e.code ?? null, failure_message: reason },
      })
      .eq("id", payment.id);
    if (e.type !== "StripeCardError") console.error("[payments] fee charge failed", err);
    if (booking.client_id && e.type === "StripeCardError") {
      return invoiceFallback(booking, coachId, amount, description, kind, reason);
    }
    return { ok: false, error: reason, amountCents: amount };
  }
}

/** Card couldn't be charged: email the client a Stripe invoice they can pay (and authenticate) online. */
async function invoiceFallback(
  booking: { id: string; business_id: string; client_id: string | null },
  coachId: string | null,
  amount: number,
  description: string,
  kind: "late_cancel" | "no_show",
  reason: string,
): Promise<{ ok: boolean; error?: string; amountCents?: number }> {
  try {
    await createClientInvoice({
      businessId: booking.business_id,
      clientId: booking.client_id!,
      coachId,
      amountCents: amount,
      description,
      purpose: "fee",
      bookingId: booking.id,
      daysUntilDue: 7,
      metadata: { fee_kind: kind },
    });
    return { ok: false, error: `${reason} We emailed the client an invoice to pay online.`, amountCents: amount };
  } catch (err) {
    console.error("[payments] fee invoice fallback failed", err);
    return { ok: false, error: reason, amountCents: amount };
  }
}
