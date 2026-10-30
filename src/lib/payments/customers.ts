import "server-only";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargeAccount, isMissing, loadBusiness, type Admin } from "@/lib/payments/shared";

// OWNER: payments. Contract used by scheduling.
//
// Customers live on each business's connected account, so one person has a
// separate Stripe customer per business (business_clients.stripe_customer_id).

/**
 * The Stripe customer for a person at a business (on its connected account),
 * creating and saving it if needed. Also makes sure the client relationship
 * row exists to hold it.
 */
export async function getOrCreateStripeCustomer(businessId: string, profileId: string, admin: Admin = createAdminClient()): Promise<string> {
  const business = await loadBusiness(admin, businessId);
  const { opts } = chargeAccount(business);

  const { data: profile, error } = await admin.from("profiles").select("id, email, full_name, phone").eq("id", profileId).single();
  if (error || !profile) throw new Error(`Profile ${profileId} not found`);

  // Holder for the customer id; never changes an existing relationship's status.
  await admin
    .from("business_clients")
    .upsert({ business_id: businessId, client_id: profileId, status: "active" }, { onConflict: "business_id,client_id", ignoreDuplicates: true });
  const { data: rel } = await admin
    .from("business_clients")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .eq("client_id", profileId)
    .single();
  const known = rel?.stripe_customer_id ?? null;

  if (known) {
    // Guard against a customer deleted in the Stripe dashboard.
    try {
      const existing = await stripe().customers.retrieve(known, {}, opts);
      if (!("deleted" in existing && existing.deleted)) return existing.id;
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  const customer = await stripe().customers.create(
    {
      email: profile.email,
      name: profile.full_name ?? undefined,
      phone: profile.phone ?? undefined,
      metadata: { profile_id: profile.id, business_id: businessId },
    },
    // Concurrent callers get the same customer back instead of duplicates.
    { ...opts, idempotencyKey: `customer:${businessId}:${profile.id}:${known ?? "new"}` },
  );

  // Only claim the column if nobody else did in the meantime.
  const query = admin.from("business_clients").update({ stripe_customer_id: customer.id }).eq("business_id", businessId).eq("client_id", profileId);
  const { data: updated } = await (known ? query.eq("stripe_customer_id", known) : query.is("stripe_customer_id", null)).select("stripe_customer_id");
  if (updated && updated.length) return customer.id;

  const { data: fresh } = await admin
    .from("business_clients")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .eq("client_id", profileId)
    .single();
  return fresh?.stripe_customer_id ?? customer.id;
}

/** A person's customer id at a business without creating one. */
export async function findStripeCustomer(businessId: string, profileId: string, admin: Admin = createAdminClient()): Promise<string | null> {
  const { data } = await admin
    .from("business_clients")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .eq("client_id", profileId)
    .maybeSingle();
  return data?.stripe_customer_id ?? null;
}

/** Remember a customer Checkout created (guest → signed-in client) if none is stored yet. */
export async function rememberStripeCustomer(admin: Admin, businessId: string, profileId: string, customerId: string) {
  await admin
    .from("business_clients")
    .update({ stripe_customer_id: customerId })
    .eq("business_id", businessId)
    .eq("client_id", profileId)
    .is("stripe_customer_id", null);
}
