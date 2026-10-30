import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessUrl } from "@/lib/tenant";
import { businessUpdateFromAccount } from "@/lib/payments/mapping";
import { resetOfferingSync } from "@/lib/payments/offerings";
import { isMissing, loadBusiness, type Admin, type Business } from "@/lib/payments/shared";

// Stripe Connect onboarding. Each business gets one connected account it
// fully owns: the business is the merchant of record, has the full Stripe
// Dashboard, pays Stripe's fees and Stripe covers losses (the controller
// equivalent of a Standard account). Onboarding runs on Stripe-hosted
// Account Links.

const STANDARD_CONTROLLER: Stripe.AccountCreateParams.Controller = {
  stripe_dashboard: { type: "full" },
  fees: { payer: "account" },
  losses: { payments: "stripe" },
  requirement_collection: "stripe",
};

/** The business's connected account id, creating the account on first use. */
export async function ensureConnectedAccount(businessId: string, admin: Admin = createAdminClient()): Promise<string> {
  const business = await loadBusiness(admin, businessId);
  if (business.stripe_account_id) return business.stripe_account_id;

  const account = await stripe().accounts.create(
    {
      controller: STANDARD_CONTROLLER,
      email: business.support_email ?? undefined,
      business_profile: {
        name: business.name,
        url: businessUrl(business, "/"),
        support_email: business.support_email ?? undefined,
      },
      metadata: { business_id: business.id },
    },
    // Concurrent clicks share a key; a reconnect after disconnecting (row updated since) gets a new account.
    { idempotencyKey: `connect-account:${business.id}:${business.updated_at}` },
  );

  // Claim the column only if nobody connected in the meantime.
  const { data: claimed } = await admin
    .from("businesses")
    .update({ stripe_account_id: account.id, ...businessUpdateFromAccount(account) })
    .eq("id", business.id)
    .is("stripe_account_id", null)
    .select("stripe_account_id");
  if (claimed?.length) {
    // Products/prices from any earlier account don't exist on this one.
    await resetOfferingSync(business.id);
    return account.id;
  }
  const fresh = await loadBusiness(admin, business.id);
  return fresh.stripe_account_id ?? account.id;
}

/** A Stripe-hosted onboarding (or update) link for the business's account. */
export async function createOnboardingLink(business: Business): Promise<string> {
  if (!business.stripe_account_id) throw new Error("No Stripe account yet");
  const link = await stripe().accountLinks.create({
    account: business.stripe_account_id,
    type: "account_onboarding",
    collect: "eventually_due",
    refresh_url: businessUrl(business, "/coach/payments/setup/link"),
    return_url: businessUrl(business, "/coach/payments/setup?return=1"),
  });
  return link.url;
}

/** Mirror the account's capabilities onto the business (account.updated, return from onboarding). */
export async function applyAccountStatus(admin: Admin, account: Stripe.Account): Promise<Business | null> {
  const { data } = await admin
    .from("businesses")
    .update(businessUpdateFromAccount(account))
    .eq("stripe_account_id", account.id)
    .select("*")
    .maybeSingle();
  return data;
}

/** Re-read the account from Stripe and store its status. */
export async function refreshAccountStatus(business: Business, admin: Admin = createAdminClient()): Promise<Business> {
  if (!business.stripe_account_id) return business;
  try {
    const account = await stripe().accounts.retrieve(business.stripe_account_id);
    return (await applyAccountStatus(admin, account)) ?? business;
  } catch (err) {
    // Disconnection is handled by account.application.deauthorized; just report here.
    console.error("[payments] account refresh failed", isMissing(err) ? "account missing" : err);
    return business;
  }
}

/** The business disconnected the platform (or the account is gone): stop charging on it. */
export async function disconnectAccount(admin: Admin, accountId: string): Promise<Business | null> {
  const { data } = await admin
    .from("businesses")
    .update({ stripe_account_id: null, stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false })
    .eq("stripe_account_id", accountId)
    .select("*")
    .maybeSingle();
  return data;
}

/** Account requirements to show on the setup page (best-effort). */
export async function accountRequirements(accountId: string): Promise<{ due: string[]; disabledReason: string | null } | null> {
  try {
    const account = await stripe().accounts.retrieve(accountId);
    return {
      due: [...(account.requirements?.past_due ?? []), ...(account.requirements?.currently_due ?? [])].filter((v, i, a) => a.indexOf(v) === i),
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  } catch (err) {
    console.error("[payments] account requirements lookup failed", err);
    return null;
  }
}
