"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { fail, ok, type ActionState } from "@/lib/actions";
import { createOnboardingLink, ensureConnectedAccount, refreshAccountStatus } from "@/lib/payments/accounts";
import { loadBusiness } from "@/lib/payments/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/stripe";

/** Create the business's Stripe account if needed and send the manager to Stripe-hosted onboarding. */
export async function connectStripeAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  if (!isStripeConfigured()) return fail("Payments aren't available on this platform right now.");
  let url: string;
  try {
    const admin = createAdminClient();
    await ensureConnectedAccount(business.id, admin);
    url = await createOnboardingLink(await loadBusiness(admin, business.id));
  } catch (err) {
    console.error("[payments] connect failed", err);
    return fail("We couldn't start Stripe onboarding. Please try again.");
  }
  redirect(url);
}

/** Re-read the account's status from Stripe (in case a webhook is delayed). */
export async function refreshStripeStatusAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  if (!business.stripe_account_id) return fail("Stripe isn't connected yet.");
  await refreshAccountStatus(business);
  revalidatePath("/coach/payments/setup");
  return ok("Status updated.");
}
