"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { fail, ok, type ActionState } from "@/lib/actions";
import { formatDate } from "@/lib/format";
import { platformPortalUrl, scheduleStarter, startPro } from "@/lib/payments/platform-billing";
import { isStripeConfigured } from "@/lib/stripe";

// Platform billing: the business's own plan, billed on the platform's Stripe account.

export async function upgradeToProAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  if (!isStripeConfigured()) return fail("Billing isn't available right now.");
  let url: string | null = null;
  try {
    const res = await startPro(business.id);
    if ("already" in res) return ok("You're already on Pro.");
    if ("resumed" in res) {
      revalidatePath("/coach/payments/plan");
      return ok("Pro will keep renewing.");
    }
    url = res.url;
  } catch (err) {
    console.error("[plan] upgrade failed", err);
    return fail("We couldn't start the upgrade. Please try again.");
  }
  redirect(url);
}

export async function switchToStarterAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  try {
    const { endsAt } = await scheduleStarter(business.id);
    revalidatePath("/coach/payments/plan");
    return ok(endsAt ? `You'll move to Starter on ${formatDate(endsAt, business.timezone)}.` : "You're on the Starter plan.");
  } catch (err) {
    console.error("[plan] downgrade failed", err);
    return fail("We couldn't change your plan. Please try again.");
  }
}

export async function managePlanBillingAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  let url: string;
  try {
    url = await platformPortalUrl(business.id);
  } catch (err) {
    console.error("[plan] portal failed", err);
    return fail("We couldn't open billing. Please try again.");
  }
  redirect(url);
}
