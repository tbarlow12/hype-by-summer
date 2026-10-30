"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { formatMoney } from "@/lib/format";
import { notify } from "@/lib/notify";
import { createClientInvoice } from "@/lib/payments/invoices";
import { refundableCents, subscriptionRowFromStripe } from "@/lib/payments/mapping";
import { refundPayment } from "@/lib/payments/refunds";
import { onAccount, stripe } from "@/lib/stripe";

// Money actions are for owners/admins; coaches only view their own payments.

const dollars = z.coerce.number().positive("Enter an amount").max(100_000).transform((v) => Math.round(v * 100));

const refundSchema = z.object({
  payment_id: z.uuid(),
  amount: z.union([z.literal(""), dollars]).optional().transform((v) => (v === "" ? undefined : v)),
  reason: zfd.text(),
  revoke_credits: zfd.checkbox(),
});

export async function refundPaymentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireManager();
  const parsed = parseForm(refundSchema, formData);
  if (parsed.error) return parsed.error;
  const { payment_id, amount, reason, revoke_credits } = parsed.data;

  const supabase = await createClient();
  const { data: payment } = await supabase.from("payments").select("*").eq("id", payment_id).eq("business_id", business.id).maybeSingle();
  if (!payment) return fail("Payment not found.");
  const max = refundableCents(payment);
  if (max <= 0) return fail("Nothing left to refund on this payment.");
  if (amount !== undefined && amount > max) return fail(`You can refund at most ${formatMoney(max, payment.currency)}.`);

  try {
    const { refundedCents } = await refundPayment(payment.id, {
      amountCents: amount,
      reason,
      revokeCredits: revoke_credits,
      actorId: profile.id,
      businessId: business.id,
    });
    revalidatePath("/coach/payments");
    return ok(`Refunded ${formatMoney(refundedCents, payment.currency)}.`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Refund failed.");
  }
}

async function isClientOf(businessId: string, clientId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_clients")
    .select("client_id")
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .maybeSingle();
  return Boolean(data);
}

async function isCoachOf(businessId: string, coachId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", coachId)
    .maybeSingle();
  return Boolean(data);
}

const chargeSchema = z.object({
  client_id: z.uuid("Choose a client"),
  coach_id: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || undefined),
  amount: z.coerce.number().min(0.5, "Minimum is $0.50").max(100_000).transform((v) => Math.round(v * 100)),
  description: zfd.requiredText("Add a description").pipe(z.string().max(250)),
  days_until_due: z.coerce.number().int().min(0).max(90).default(7),
});

export async function chargeClientAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(chargeSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  if (!business.stripe_account_id || !business.stripe_charges_enabled) return fail("Connect Stripe first (Payments → Setup).");
  if (!(await isClientOf(business.id, v.client_id))) return fail("That person isn't one of your clients.");
  if (v.coach_id && !(await isCoachOf(business.id, v.coach_id))) return fail("Unknown coach.");
  try {
    await createClientInvoice({
      businessId: business.id,
      clientId: v.client_id,
      coachId: v.coach_id,
      amountCents: v.amount,
      description: v.description,
      daysUntilDue: v.days_until_due,
    });
    revalidatePath("/coach/payments");
    return ok(`Invoice for ${formatMoney(v.amount)} emailed to the client.`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not create the invoice.");
  }
}

const creditSchema = z.object({
  client_id: z.uuid("Choose a client"),
  amount: z.coerce.number().int().min(-1000).max(1000).refine((n) => n !== 0, "Enter a non-zero number of credits"),
  expires_days: zfd.optionalInt().pipe(z.number().int().min(1).max(3650).optional()),
  "session_type_ids[]": z.array(z.uuid()).optional(),
  note: zfd.text(),
});

export async function adjustCreditsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireManager();
  const parsed = parseForm(creditSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  if (!(await isClientOf(business.id, v.client_id))) return fail("That person isn't one of your clients.");
  const admin = createAdminClient();

  if (v.amount > 0) {
    const types = v["session_type_ids[]"] ?? [];
    if (types.length) {
      const { data: owned } = await admin.from("session_types").select("id").eq("business_id", business.id).in("id", types);
      if ((owned ?? []).length !== types.length) return fail("Unknown session type.");
    }
    const { error } = await admin.from("credit_ledger").insert({
      business_id: business.id,
      client_id: v.client_id,
      delta: v.amount,
      reason: "adjustment",
      session_type_ids: types.length ? types : null,
      expires_at: v.expires_days ? new Date(Date.now() + v.expires_days * 86_400_000).toISOString() : null,
      note: v.note ?? "Added by your coach",
      created_by: profile.id,
    });
    if (error) return fail(error.message);
    await notify({
      userId: v.client_id,
      businessId: business.id,
      type: "credits",
      title: `${v.amount} session credit${v.amount === 1 ? "" : "s"} added`,
      body: v.note ?? undefined,
      link: "/me/billing",
    });
    revalidatePath("/coach/payments");
    return ok(`Added ${v.amount} credit${v.amount === 1 ? "" : "s"}.`);
  }

  const { data: removed, error } = await admin.rpc("debit_credits", {
    p_client: v.client_id,
    p_business: business.id,
    p_amount: -v.amount,
    p_reason: "adjustment",
    p_note: v.note ?? null,
    p_created_by: profile.id,
  });
  if (error) return fail(error.message);
  revalidatePath("/coach/payments");
  if (!removed) return fail("This client has no unused credits to remove.");
  return ok(removed < -v.amount ? `Only ${removed} credit(s) were available; removed them all.` : `Removed ${removed} credit${removed === 1 ? "" : "s"}.`);
}

const subSchema = z.object({ subscription_id: z.uuid(), cancel: z.enum(["true", "false"]) });

export async function setSubscriptionCancelAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(subSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, stripe_subscription_id, status")
    .eq("id", parsed.data.subscription_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!sub) return fail("Membership not found.");
  if (sub.status === "canceled") return fail("This membership has already ended.");
  if (!business.stripe_account_id) return fail("Stripe isn't connected.");
  const cancel = parsed.data.cancel === "true";
  try {
    const updated = await stripe().subscriptions.update(
      sub.stripe_subscription_id,
      cancel ? { cancel_at_period_end: true } : { cancel_at_period_end: false, cancel_at: "" },
      onAccount(business.stripe_account_id),
    );
    await createAdminClient().from("subscriptions").update(subscriptionRowFromStripe(updated)).eq("id", sub.id);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Stripe update failed.");
  }
  revalidatePath("/coach/payments");
  return ok(cancel ? "Membership will end at the close of the current period." : "Membership will renew as normal.");
}
