import "server-only";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
import { notify } from "@/lib/notify";
import { brandOf } from "@/lib/tenant";
import { getOrCreateStripeCustomer } from "@/lib/payments/customers";
import { applicationFeeAmount } from "@/lib/payments/fees";
import { attributeCoach, chargeAccount, linkClientToBusiness, loadBusiness } from "@/lib/payments/shared";
import type { Database, Json } from "@/lib/supabase/database.types";

type Purpose = Database["public"]["Enums"]["payment_purpose"];

/**
 * Bill a client of a business a custom amount with a Stripe Invoice on the
 * business's connected account. The hosted invoice URL is emailed (branded)
 * and shown on the client's billing page; invoice.paid marks the payment
 * succeeded. Returns the payment id.
 */
export async function createClientInvoice(input: {
  businessId: string;
  clientId: string;
  amountCents: number;
  description: string;
  /** Commission attribution; defaults to the booking's coach / client's primary coach. */
  coachId?: string | null;
  currency?: string;
  daysUntilDue?: number;
  purpose?: Purpose;
  bookingId?: string | null;
  metadata?: Record<string, string>;
}): Promise<{ paymentId: string; hostedInvoiceUrl: string | null }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 50) throw new Error("Amount must be at least $0.50");
  const admin = createAdminClient();
  const business = await loadBusiness(admin, input.businessId);
  const { account, opts } = chargeAccount(business);
  const currency = (input.currency ?? "usd").toLowerCase();
  const purpose = input.purpose ?? "invoice";

  const { data: client } = await admin.from("profiles").select("id, email, full_name").eq("id", input.clientId).single();
  if (!client) throw new Error("Client not found");
  const coachId = input.coachId ?? (await attributeCoach(admin, business.id, { bookingId: input.bookingId, clientId: input.clientId }));

  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      business_id: business.id,
      client_id: input.clientId,
      coach_id: coachId,
      payer_email: client.email,
      purpose,
      status: "pending",
      amount_cents: input.amountCents,
      currency,
      description: input.description,
      booking_id: input.bookingId ?? null,
      stripe_account_id: account,
      metadata: (input.metadata ?? {}) as Json,
    })
    .select("id")
    .single();
  if (error || !payment) throw new Error(error?.message ?? "Could not record payment");

  try {
    const s = stripe();
    const customer = await getOrCreateStripeCustomer(business.id, input.clientId, admin);
    const metadata = {
      kind: purpose,
      payment_id: payment.id,
      business_id: business.id,
      client_id: input.clientId,
      ...(coachId ? { coach_id: coachId } : {}),
      ...(input.bookingId ? { booking_id: input.bookingId } : {}),
      ...(input.metadata ?? {}),
    };
    const fee = applicationFeeAmount(input.amountCents, business);
    const invoice = await s.invoices.create(
      {
        customer,
        collection_method: "send_invoice",
        days_until_due: input.daysUntilDue ?? 7,
        description: input.description,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        currency,
        metadata,
        ...(fee ? { application_fee_amount: fee } : {}),
      },
      { ...opts, idempotencyKey: `invoice:${payment.id}` },
    );
    await s.invoiceItems.create(
      { customer, invoice: invoice.id, amount: input.amountCents, currency, description: input.description, metadata },
      { ...opts, idempotencyKey: `invoice-item:${payment.id}` },
    );
    const finalized = await s.invoices.finalizeInvoice(invoice.id, {}, { ...opts, idempotencyKey: `invoice-finalize:${payment.id}` });

    await admin
      .from("payments")
      .update({
        stripe_invoice_id: finalized.id,
        hosted_invoice_url: finalized.hosted_invoice_url ?? null,
        metadata: { ...(input.metadata ?? {}), invoice_number: finalized.number, invoice_pdf: finalized.invoice_pdf ?? null } as Json,
      })
      .eq("id", payment.id);

    await linkClientToBusiness(admin, business.id, input.clientId);

    const amount = formatMoney(input.amountCents, currency);
    if (finalized.hosted_invoice_url) {
      await sendEmail({
        brand: brandOf(business),
        to: client.email,
        subject: `Invoice: ${input.description} (${amount})`,
        heading: `You have a new invoice for ${amount}`,
        paragraphs: [
          `Hi ${client.full_name?.split(" ")[0] ?? "there"},`,
          `${input.description}.`,
          `You can pay securely online with the link below. It's also available any time under Billing in your account.`,
        ],
        cta: { label: `Pay ${amount}`, url: finalized.hosted_invoice_url },
      });
    }
    await notify({
      userId: input.clientId,
      businessId: business.id,
      type: "invoice",
      title: `New invoice: ${amount}`,
      body: input.description,
      link: "/me/billing",
    });
    return { paymentId: payment.id, hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
  } catch (err) {
    await admin
      .from("payments")
      .update({ status: "failed", metadata: { error: err instanceof Error ? err.message : String(err) } })
      .eq("id", payment.id);
    throw err;
  }
}
