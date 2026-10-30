"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { syncAllOfferings, syncOfferingToStripe } from "@/lib/payments/offerings";
import { DIGITAL_BUCKET } from "@/lib/payments/shared";
import { isStripeConfigured } from "@/lib/stripe";

const schema = z
  .object({
    id: z.uuid().optional().or(z.literal("").transform(() => undefined)),
    kind: z.enum(["package", "subscription", "one_time"]),
    name: zfd.requiredText("Give it a name").pipe(z.string().max(120)),
    description: zfd.text(),
    features: zfd.text(),
    price: z.coerce.number().min(0.5, "Price must be at least $0.50").max(100_000).transform((v) => Math.round(v * 100)),
    currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/, "Use a 3-letter currency code").default("usd"),
    billing_interval: z.enum(["week", "month", "year"]).optional().or(z.literal("").transform(() => undefined)),
    interval_count: z.coerce.number().int().min(1).max(12).default(1),
    trial_days: z.coerce.number().int().min(0).max(730).default(0),
    credits: z.coerce.number().int().min(0).max(1000).default(0),
    credits_expire_days: zfd.optionalInt().pipe(z.number().int().min(1).max(3650).optional()),
    "session_type_ids[]": z.array(z.uuid()).optional(),
    includes_messaging: zfd.checkbox(),
    includes_programming: zfd.checkbox(),
    digital_file_path: zfd.text(),
    digital_file_name: zfd.text(),
    active: zfd.checkbox(),
    featured: zfd.checkbox(),
    sort_order: z.coerce.number().int().min(-1000).max(1000).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "subscription" && !v.billing_interval) {
      ctx.addIssue({ code: "custom", path: ["billing_interval"], message: "Choose how often members are billed" });
    }
    if (v.kind === "package" && v.credits < 1) {
      ctx.addIssue({ code: "custom", path: ["credits"], message: "A package needs at least 1 session credit" });
    }
  });

export async function saveOffering(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const supabase = await createClient();

  if (v.digital_file_path && !v.digital_file_path.startsWith(`${business.id}/`)) return fail("Invalid file upload.");

  // Session types must belong to this business.
  const sessionTypeIds = v["session_type_ids[]"] ?? [];
  if (sessionTypeIds.length) {
    const { data: owned } = await supabase.from("session_types").select("id").eq("business_id", business.id).in("id", sessionTypeIds);
    if ((owned ?? []).length !== sessionTypeIds.length) return fail("Unknown session type selected.");
  }

  const row = {
    business_id: business.id,
    name: v.name,
    description: v.description ?? null,
    features: (v.features ?? "").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 20),
    price_cents: v.price,
    currency: v.currency,
    billing_interval: v.kind === "subscription" ? v.billing_interval! : null,
    interval_count: v.kind === "subscription" ? v.interval_count : 1,
    trial_days: v.kind === "subscription" ? v.trial_days : 0,
    credits: v.credits,
    credits_expire_days: v.credits > 0 ? (v.credits_expire_days ?? null) : null,
    session_type_ids: sessionTypeIds.length ? sessionTypeIds : null,
    includes_messaging: v.includes_messaging,
    includes_programming: v.includes_programming,
    digital_file_path: v.kind === "one_time" ? (v.digital_file_path ?? null) : null,
    digital_file_name: v.kind === "one_time" && v.digital_file_path ? (v.digital_file_name ?? null) : null,
    active: v.active,
    featured: v.featured,
    sort_order: v.sort_order,
  };

  let id = v.id;
  if (id) {
    const { data: existing } = await supabase.from("offerings").select("kind, digital_file_path").eq("id", id).eq("business_id", business.id).maybeSingle();
    if (!existing) return fail("Offering not found.");
    if (existing.kind !== v.kind) return fail("The type of an existing offering can't be changed. Create a new one instead.");
    const { error } = await supabase.from("offerings").update(row).eq("id", id).eq("business_id", business.id);
    if (error) return fail(error.message);
    if (existing.digital_file_path && existing.digital_file_path !== row.digital_file_path) {
      await supabase.storage.from(DIGITAL_BUCKET).remove([existing.digital_file_path]);
    }
  } else {
    const { data, error } = await supabase.from("offerings").insert({ ...row, kind: v.kind }).select("id").single();
    if (error) return fail(error.message);
    id = data.id;
  }

  let syncError: string | null = null;
  if (isStripeConfigured() && business.stripe_account_id) {
    try {
      await syncOfferingToStripe(id);
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Stripe sync failed";
    }
  }
  revalidatePath("/coach/offerings");
  revalidatePath("/pricing");
  redirect(`/coach/offerings?saved=${encodeURIComponent(v.name)}${syncError ? "&sync=failed" : ""}`);
}

const idSchema = z.object({ id: z.uuid() });

async function ownedOffering(formData: FormData) {
  const { business } = await requireManager();
  const parsed = parseForm(idSchema, formData);
  if (parsed.error) return { error: parsed.error };
  const supabase = await createClient();
  const { data } = await supabase.from("offerings").select("*").eq("id", parsed.data.id).eq("business_id", business.id).maybeSingle();
  if (!data) return { error: fail("Offering not found.") };
  return { offering: data, supabase, business };
}

export async function setOfferingActive(_: ActionState, formData: FormData): Promise<ActionState> {
  const res = await ownedOffering(formData);
  if (res.error) return res.error;
  const active = formData.get("active") === "true";
  const { error } = await res.supabase.from("offerings").update({ active }).eq("id", res.offering.id);
  if (error) return fail(error.message);
  let message = active ? "Offering is live." : "Offering hidden.";
  if (isStripeConfigured() && res.business.stripe_account_id) {
    try {
      await syncOfferingToStripe(res.offering.id);
    } catch (err) {
      message += ` Stripe sync failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }
  revalidatePath("/coach/offerings");
  revalidatePath("/pricing");
  return ok(message);
}

export async function resyncOffering(_: ActionState, formData: FormData): Promise<ActionState> {
  const res = await ownedOffering(formData);
  if (res.error) return res.error;
  if (!isStripeConfigured()) return fail("Online payments aren't available right now.");
  if (!res.business.stripe_account_id) return fail("Connect Stripe first (Payments → Setup).");
  try {
    await syncOfferingToStripe(res.offering.id);
  } catch (err) {
    revalidatePath("/coach/offerings");
    return fail(err instanceof Error ? err.message : "Stripe sync failed");
  }
  revalidatePath("/coach/offerings");
  return ok("Synced with Stripe.");
}

export async function deleteOffering(_: ActionState, formData: FormData): Promise<ActionState> {
  const res = await ownedOffering(formData);
  if (res.error) return res.error;
  const { offering, supabase } = res;
  const [{ count: payments }, { count: subs }] = await Promise.all([
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("offering_id", offering.id),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("offering_id", offering.id),
  ]);
  if ((payments ?? 0) > 0 || (subs ?? 0) > 0) {
    return fail("This offering has purchases, so it can't be deleted. Hide it instead to stop new sales.");
  }
  if (offering.stripe_product_id && isStripeConfigured() && res.business.stripe_account_id) {
    await supabase.from("offerings").update({ active: false }).eq("id", offering.id);
    try {
      await syncOfferingToStripe(offering.id);
    } catch (err) {
      console.error("[offerings] archive before delete failed", err);
    }
  }
  const { error } = await supabase.from("offerings").delete().eq("id", offering.id);
  if (error) return fail(error.message);
  if (offering.digital_file_path) await supabase.storage.from(DIGITAL_BUCKET).remove([offering.digital_file_path]);
  revalidatePath("/coach/offerings");
  revalidatePath("/pricing");
  redirect("/coach/offerings");
}

export async function syncAllOfferingsAction(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business } = await requireManager();
  if (!isStripeConfigured() || !business.stripe_account_id) return fail("Connect Stripe first (Payments → Setup).");
  const { synced, failed } = await syncAllOfferings(business.id);
  revalidatePath("/coach/offerings");
  return failed ? fail(`Synced ${synced}; ${failed} failed. Open them to see why.`) : ok(`Synced ${synced} offering${synced === 1 ? "" : "s"} with Stripe.`);
}
