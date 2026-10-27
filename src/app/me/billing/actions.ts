"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";
import { notify } from "@/lib/notify";
import { getOrCreateStripeCustomer } from "@/lib/payments/customers";
import { subscriptionRowFromStripe } from "@/lib/payments/mapping";
import { createPortalSession } from "@/lib/payments/portal";
import { isStripeConfigured, stripe } from "@/lib/stripe";

export async function openBillingPortal(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const profile = await requireClient();
  if (!isStripeConfigured()) return fail("Online billing isn't available right now.");
  let url: string;
  try {
    const customer = await getOrCreateStripeCustomer(profile.id);
    url = await createPortalSession(customer, "/me/billing");
  } catch (err) {
    console.error("[billing] portal failed", err);
    return fail("We couldn't open the billing portal. Please try again.");
  }
  redirect(url);
}

const subSchema = z.object({ subscription_id: z.uuid(), cancel: z.enum(["true", "false"]) });

export async function setMySubscriptionCancel(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(subSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, stripe_subscription_id, status, trainer_id, offering:offerings(name)")
    .eq("id", parsed.data.subscription_id)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!sub) return fail("Membership not found.");
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return fail("This membership has already ended.");
  const cancel = parsed.data.cancel === "true";
  try {
    const updated = await stripe().subscriptions.update(
      sub.stripe_subscription_id,
      cancel ? { cancel_at_period_end: true } : { cancel_at_period_end: false, cancel_at: "" },
    );
    await createAdminClient().from("subscriptions").update(subscriptionRowFromStripe(updated)).eq("id", sub.id);
  } catch (err) {
    console.error("[billing] subscription update failed", err);
    return fail("We couldn't update your membership. Please try again.");
  }
  await notify({
    userId: sub.trainer_id,
    type: cancel ? "subscription_cancelling" : "subscription_resumed",
    title: `${profile.full_name ?? profile.email} ${cancel ? "cancelled" : "resumed"} ${sub.offering?.name ?? "their membership"}`,
    link: "/coach/payments#subscriptions",
  });
  revalidatePath("/me/billing");
  return ok(cancel ? "Your membership will end at the close of the current period." : "Your membership will renew as normal.");
}
