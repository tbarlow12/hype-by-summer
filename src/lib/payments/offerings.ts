import "server-only";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessUrl } from "@/lib/tenant";
import { chargeAccount, isMissing, loadBusiness } from "@/lib/payments/shared";
import type { Tables } from "@/lib/supabase/database.types";

export type Offering = Tables<"offerings">;

/** Deterministic Stripe product id so retries never create duplicates. */
export const productIdFor = (offeringId: string) => `offering_${offeringId.replace(/-/g, "")}`;

function priceMatches(price: Stripe.Price, o: Offering): boolean {
  if (price.unit_amount !== o.price_cents || price.currency !== o.currency.toLowerCase()) return false;
  if (o.kind === "subscription") {
    return price.recurring?.interval === o.billing_interval && (price.recurring?.interval_count ?? 1) === o.interval_count;
  }
  return price.recurring == null;
}

/**
 * Create/update the Stripe Product for an offering on the business's
 * connected account and make sure its Price matches. Prices are immutable: a
 * changed amount or interval creates a new Price and archives the old one.
 * Deactivated offerings archive both. Records sync status; returns the row.
 */
export async function syncOfferingToStripe(offeringId: string): Promise<Offering> {
  const admin = createAdminClient();
  const { data: o, error } = await admin.from("offerings").select("*").eq("id", offeringId).single();
  if (error || !o) throw new Error("Offering not found");
  const business = await loadBusiness(admin, o.business_id);

  try {
    const { opts } = chargeAccount(business);
    const s = stripe();
    const productParams = {
      name: o.name,
      description: o.description?.trim() || undefined,
      active: o.active,
      metadata: { offering_id: o.id, business_id: o.business_id, kind: o.kind },
      url: businessUrl(business, "/pricing"),
    };

    // Product ----------------------------------------------------------------
    let productId = o.stripe_product_id ?? productIdFor(o.id);
    try {
      await s.products.update(productId, productParams, opts);
    } catch (err) {
      if (!isMissing(err)) throw err;
      const created = await s.products
        .create({ id: productIdFor(o.id), ...productParams }, { ...opts, idempotencyKey: `offering-product:${business.stripe_account_id}:${o.id}` })
        .catch(async (e: { code?: string }) => {
          // Created on an earlier attempt whose DB write failed.
          if (e.code === "resource_already_exists") return s.products.update(productIdFor(o.id), productParams, opts);
          throw e;
        });
      productId = created.id;
    }

    // Price ------------------------------------------------------------------
    let priceId = o.stripe_price_id;
    let current: Stripe.Price | null = null;
    if (priceId) {
      try {
        current = await s.prices.retrieve(priceId, {}, opts);
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }

    if (o.active) {
      if (current && current.product === productId && priceMatches(current, o)) {
        if (!current.active) await s.prices.update(current.id, { active: true }, opts);
      } else {
        const recurring =
          o.kind === "subscription" && o.billing_interval
            ? { interval: o.billing_interval, interval_count: o.interval_count }
            : undefined;
        const created = await s.prices.create(
          {
            product: productId,
            currency: o.currency.toLowerCase(),
            unit_amount: o.price_cents,
            recurring,
            metadata: { offering_id: o.id },
          },
          {
            ...opts,
            idempotencyKey: `offering-price:${o.id}:${o.price_cents}:${o.currency}:${o.billing_interval ?? "once"}:${o.interval_count}:${current?.id ?? "none"}`,
          },
        );
        await s.products.update(productId, { default_price: created.id }, opts);
        if (current?.active) await s.prices.update(current.id, { active: false }, opts);
        priceId = created.id;
      }
    } else if (current?.active) {
      // Existing subscribers keep their price; it just can't be bought anymore.
      await s.prices.update(current.id, { active: false }, opts);
    }

    const { data: saved, error: saveErr } = await admin
      .from("offerings")
      .update({
        stripe_product_id: productId,
        stripe_price_id: priceId,
        stripe_synced_at: new Date().toISOString(),
        stripe_sync_error: null,
      })
      .eq("id", o.id)
      .select("*")
      .single();
    if (saveErr) throw saveErr;
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payments] offering sync failed", o.id, err);
    await admin.from("offerings").update({ stripe_sync_error: message.slice(0, 500) }).eq("id", o.id);
    throw new Error(`Stripe sync failed: ${message}`);
  }
}

/** True when the offering's Stripe objects reflect its current state. */
export function isOfferingSynced(o: Pick<Offering, "stripe_synced_at" | "updated_at" | "stripe_sync_error" | "stripe_price_id" | "active">): boolean {
  if (o.stripe_sync_error) return false;
  if (!o.stripe_synced_at) return false;
  if (o.active && !o.stripe_price_id) return false;
  // updated_at bumps on every write, including the sync write itself.
  return new Date(o.stripe_synced_at).getTime() >= new Date(o.updated_at).getTime() - 5_000;
}

/**
 * Forget Stripe ids from another account (a newly connected account starts
 * empty). Offerings re-sync on save, on "Sync all", or lazily at checkout.
 */
export async function resetOfferingSync(businessId: string): Promise<void> {
  await createAdminClient()
    .from("offerings")
    .update({ stripe_product_id: null, stripe_price_id: null, stripe_synced_at: null, stripe_sync_error: null })
    .eq("business_id", businessId);
}

/** Sync every offering of a business (after connecting Stripe). Returns failures. */
export async function syncAllOfferings(businessId: string): Promise<{ synced: number; failed: number }> {
  const { data } = await createAdminClient().from("offerings").select("id").eq("business_id", businessId);
  let synced = 0;
  let failed = 0;
  for (const { id } of data ?? []) {
    try {
      await syncOfferingToStripe(id);
      synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}
