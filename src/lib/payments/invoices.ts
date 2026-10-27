import "server-only";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/format";
import { notify } from "@/lib/notify";
import { getOrCreateStripeCustomer } from "@/lib/payments/customers";
import { linkClientToTrainer } from "@/lib/payments/shared";
import type { Database, Json } from "@/lib/supabase/database.types";

type Purpose = Database["public"]["Enums"]["payment_purpose"];

/**
 * Bill a client a custom amount with a Stripe Invoice. The hosted invoice URL
 * is emailed to the client (and shown in their billing page); the webhook
 * (invoice.paid) marks the payment succeeded. Returns the payment id.
 */
export async function createClientInvoice(input: {
  trainerId: string;
  clientId: string;
  amountCents: number;
  description: string;
  currency?: string;
  daysUntilDue?: number;
  purpose?: Purpose;
  bookingId?: string | null;
  metadata?: Record<string, string>;
}): Promise<{ paymentId: string; hostedInvoiceUrl: string | null }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 50) throw new Error("Amount must be at least $0.50");
  const admin = createAdminClient();
  const currency = (input.currency ?? "usd").toLowerCase();
  const purpose = input.purpose ?? "invoice";

  const { data: client } = await admin.from("profiles").select("id, email, full_name").eq("id", input.clientId).single();
  if (!client) throw new Error("Client not found");

  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      trainer_id: input.trainerId,
      client_id: input.clientId,
      payer_email: client.email,
      purpose,
      status: "pending",
      amount_cents: input.amountCents,
      currency,
      description: input.description,
      booking_id: input.bookingId ?? null,
      metadata: (input.metadata ?? {}) as Json,
    })
    .select("id")
    .single();
  if (error || !payment) throw new Error(error?.message ?? "Could not record payment");

  try {
    const s = stripe();
    const customer = await getOrCreateStripeCustomer(input.clientId);
    const metadata = {
      kind: purpose,
      payment_id: payment.id,
      trainer_id: input.trainerId,
      client_id: input.clientId,
      ...(input.bookingId ? { booking_id: input.bookingId } : {}),
      ...(input.metadata ?? {}),
    };
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
      },
      { idempotencyKey: `invoice:${payment.id}` },
    );
    await s.invoiceItems.create(
      { customer, invoice: invoice.id, amount: input.amountCents, currency, description: input.description, metadata },
      { idempotencyKey: `invoice-item:${payment.id}` },
    );
    const finalized = await s.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `invoice-finalize:${payment.id}` });

    await admin
      .from("payments")
      .update({
        stripe_invoice_id: finalized.id,
        hosted_invoice_url: finalized.hosted_invoice_url ?? null,
        metadata: { ...(input.metadata ?? {}), invoice_number: finalized.number, invoice_pdf: finalized.invoice_pdf ?? null } as Json,
      })
      .eq("id", payment.id);

    await linkClientToTrainer(admin, input.trainerId, input.clientId);

    const amount = formatMoney(input.amountCents, currency);
    if (finalized.hosted_invoice_url) {
      await sendEmail({
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
