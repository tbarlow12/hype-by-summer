import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";
import { onAccount } from "@/lib/stripe";
import type { Tables } from "@/lib/supabase/database.types";

export type Admin = ReturnType<typeof createAdminClient>;
export type Business = Tables<"businesses">;

export const isUniqueViolation = (err: { code?: string } | null | undefined) => err?.code === "23505";
export const isMissing = (err: unknown) => (err as { code?: string } | null)?.code === "resource_missing";

export const automaticTaxEnabled = () => serverEnv.stripeAutomaticTax();

export class PaymentsUnavailableError extends Error {
  constructor(message = "This business isn't set up to take online payments yet.") {
    super(message);
  }
}

/** Full business row (service role: plan/Stripe columns aren't readable by app users). */
export async function loadBusiness(admin: Admin, businessId: string): Promise<Business> {
  const { data, error } = await admin.from("businesses").select("*").eq("id", businessId).single();
  if (error || !data) throw new Error(`Business ${businessId} not found`);
  return data;
}

/** Connected account + request options for charging on behalf of a business. */
export function chargeAccount(business: Pick<Business, "stripe_account_id" | "stripe_charges_enabled">): {
  account: string;
  opts: Stripe.RequestOptions;
} {
  if (!business.stripe_account_id || !business.stripe_charges_enabled) throw new PaymentsUnavailableError();
  return { account: business.stripe_account_id, opts: onAccount(business.stripe_account_id) };
}

/** Is the person staff (any active member) of the business? */
export async function isStaffOf(admin: Admin, businessId: string, profileId: string): Promise<boolean> {
  const { data } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", profileId)
    .eq("active", true)
    .maybeSingle();
  return Boolean(data);
}

/** Make a paying person an (active) client of the business and open their chat thread. Idempotent. */
export async function linkClientToBusiness(admin: Admin, businessId: string, clientId: string | null | undefined) {
  if (!clientId || (await isStaffOf(admin, businessId, clientId))) return;
  await admin
    .from("business_clients")
    .upsert({ business_id: businessId, client_id: clientId, status: "active" }, { onConflict: "business_id,client_id", ignoreDuplicates: true });
  // Re-activate an archived/paused relationship when they buy again.
  await admin
    .from("business_clients")
    .update({ status: "active" })
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .in("status", ["archived", "paused", "invited"]);
  await admin.rpc("ensure_conversation", { p_business: businessId, p_client: clientId });
}

/**
 * Coach a payment is attributed to (commission reporting): the booking's
 * coach, else the client's primary coach at the business.
 */
export async function attributeCoach(
  admin: Admin,
  businessId: string,
  ref: { bookingId?: string | null; clientId?: string | null },
): Promise<string | null> {
  if (ref.bookingId) {
    const { data } = await admin.from("bookings").select("coach_id").eq("id", ref.bookingId).eq("business_id", businessId).maybeSingle();
    if (data?.coach_id) return data.coach_id;
  }
  if (ref.clientId) {
    const { data } = await admin
      .from("business_clients")
      .select("primary_coach_id")
      .eq("business_id", businessId)
      .eq("client_id", ref.clientId)
      .maybeSingle();
    if (data?.primary_coach_id) return data.primary_coach_id;
  }
  return null;
}

/** Staff to tell about money events: the attributed coach plus owners/admins (deduplicated). */
export async function moneyRecipients(admin: Admin, businessId: string, coachId: string | null | undefined): Promise<string[]> {
  const { data } = await admin
    .from("business_members")
    .select("user_id, role")
    .eq("business_id", businessId)
    .eq("active", true)
    .in("role", ["owner", "admin"]);
  const ids = new Set((data ?? []).map((m) => m.user_id));
  if (coachId) ids.add(coachId);
  return [...ids];
}

export const DIGITAL_BUCKET = "digital-products";

/** Signed download URL for a purchased digital product. */
export async function signedDownloadUrl(
  admin: Admin,
  path: string,
  fileName: string | null,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(DIGITAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds, { download: fileName ?? path.split("/").pop() ?? true });
  if (error) {
    console.error("[payments] signed url failed", error);
    return null;
  }
  return data.signedUrl;
}
