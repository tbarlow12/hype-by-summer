import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusiness, requireBusiness, type Business } from "@/lib/tenant";
import { platformUrl } from "@/lib/platform";
import { ensureClientLinked } from "@/lib/onboarding";
import type { Enums, Tables } from "@/lib/supabase/database.types";

// Roles are per business: a person is staff (business_members) or a client
// (business_clients) of the business whose site they're on. Platform admins
// are flagged on their profile.

export type Profile = Tables<"profiles">;
export type MemberRole = Enums<"member_role">;
export type Membership = Pick<Tables<"business_members">, "business_id" | "user_id" | "role" | "slug" | "title" | "is_bookable" | "active">;

/** Current user's profile, or null when signed out. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (data && !data.is_platform_admin && isPlatformAdminEmail(data.email)) return promoteToPlatformAdmin(data);
  return data;
});

/** PLATFORM_ADMIN_EMAILS (comma-separated) run the platform itself. */
export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && admins.includes(email!.toLowerCase());
}

async function promoteToPlatformAdmin(profile: Profile): Promise<Profile> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ is_platform_admin: true })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[auth] platform admin promotion failed", error);
    return profile;
  }
  return data;
}

/** The current user's staff membership in the current business, if any. */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const [profile, business] = await Promise.all([getProfile(), getBusiness()]);
  if (!profile || !business) return null;
  const { data } = await createAdminClient()
    .from("business_members")
    .select("business_id, user_id, role, slug, title, is_bookable, active")
    .eq("business_id", business.id)
    .eq("user_id", profile.id)
    .eq("active", true)
    .maybeSingle();
  return data;
});

export async function requireUser(next?: string): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return profile;
}

export type StaffContext = { profile: Profile; business: Business; membership: Membership };

/**
 * Staff of the current business (optionally with one of `roles`). Clients are
 * sent to their portal; staff without the role go to the coach dashboard.
 */
export async function requireStaff(roles?: MemberRole[]): Promise<StaffContext> {
  const business = await requireBusiness();
  const profile = await requireUser("/coach");
  const membership = await getMembership();
  if (!membership) redirect("/me");
  if (roles && !roles.includes(membership.role)) redirect("/coach");
  return { profile, business, membership };
}

/** Owners and admins: settings, prices, payouts, team. */
export function requireManager(): Promise<StaffContext> {
  return requireStaff(["owner", "admin"]);
}

export function isManager(membership: Pick<Membership, "role"> | null): boolean {
  return membership?.role === "owner" || membership?.role === "admin";
}

export type ClientContext = { profile: Profile; business: Business };

/**
 * A client of the current business. Signing in on a business's site makes
 * the person its client (first visit links them). Staff go to /coach.
 */
export async function requireClient(): Promise<ClientContext> {
  const business = await requireBusiness();
  const profile = await requireUser("/me");
  if (await getMembership()) redirect("/coach");
  await ensureClientLinked(profile, business.id);
  return { profile, business };
}

/** Where a signed-in person lands on this site. */
export async function homeFor(): Promise<string> {
  const business = await getBusiness();
  if (!business) {
    const profile = await getProfile();
    return profile?.is_platform_admin ? "/admin" : "/start";
  }
  return (await getMembership()) ? "/coach" : "/me";
}

export async function requirePlatformAdmin(): Promise<Profile> {
  const profile = await requireUser("/admin");
  if (!profile.is_platform_admin) redirect(platformUrl("/"));
  return profile;
}
