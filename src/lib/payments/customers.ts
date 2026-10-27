import "server-only";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// OWNER: payments.

/** Returns the Stripe customer id for a profile, creating + saving it if needed. */
export async function getOrCreateStripeCustomer(profileId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, email, full_name, phone, stripe_customer_id")
    .eq("id", profileId)
    .single();
  if (error || !profile) throw new Error(`Profile ${profileId} not found`);

  if (profile.stripe_customer_id) {
    // Guard against a customer deleted in the Stripe dashboard.
    try {
      const existing = await stripe().customers.retrieve(profile.stripe_customer_id);
      if (!("deleted" in existing && existing.deleted)) return existing.id;
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
  }

  const customer = await stripe().customers.create(
    {
      email: profile.email,
      name: profile.full_name ?? undefined,
      phone: profile.phone ?? undefined,
      metadata: { profile_id: profile.id },
    },
    // Concurrent callers get the same customer back instead of duplicates.
    { idempotencyKey: `customer:${profile.id}:${profile.stripe_customer_id ?? "new"}` },
  );

  // Only claim the column if nobody else did in the meantime.
  const query = admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", profile.id);
  const { data: updated } = await (profile.stripe_customer_id
    ? query.eq("stripe_customer_id", profile.stripe_customer_id)
    : query.is("stripe_customer_id", null)
  ).select("stripe_customer_id");
  if (updated && updated.length) return customer.id;

  const { data: fresh } = await admin.from("profiles").select("stripe_customer_id").eq("id", profile.id).single();
  return fresh?.stripe_customer_id ?? customer.id;
}

/** Finds a customer id for a profile without creating one. */
export async function findStripeCustomer(profileId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("stripe_customer_id").eq("id", profileId).maybeSingle();
  return data?.stripe_customer_id ?? null;
}
