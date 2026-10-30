import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant";
import type { Tables } from "@/lib/supabase/database.types";

export type Profile = Tables<"profiles">;

/** Current user's profile, or null when signed out. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (data && data.role !== "admin" && isPlatformAdminEmail(data.email)) return promote(data, "admin");
  return data;
});

/**
 * PLATFORM_ADMIN_EMAILS (comma-separated) run the platform: they get the admin
 * role on sign-in. Trainers get their role by signing up at /start.
 */
export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && admins.includes(email!.toLowerCase());
}

async function promote(profile: Profile, role: "admin" | "trainer"): Promise<Profile> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ role })
    .eq("id", profile.id)
    .select("*")
    .single();
  if (error || !data) {
    console.error("[auth] role promotion failed", error);
    return profile;
  }
  return data;
}

export async function requireUser(next?: string): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return profile;
}

/** Trainer or admin. Clients are sent to their portal. */
export async function requireTrainer(): Promise<Profile> {
  const profile = await requireUser("/coach");
  if (profile.role === "client") redirect("/me");
  return profile;
}

export async function requireClient(): Promise<Profile> {
  const profile = await requireUser("/me");
  if (profile.role !== "client") redirect("/coach");
  return profile;
}

export function homeFor(profile: Pick<Profile, "role">): string {
  return profile.role === "client" ? "/me" : "/coach";
}

/**
 * The trainer a client works with on this site: the current tenant when the
 * client belongs to it, else their first active relationship.
 */
export const getClientTrainerId = cache(async (clientId: string): Promise<string | null> => {
  const tenant = await getTenant();
  const supabase = await createClient();
  if (tenant) {
    const { data: link } = await supabase
      .from("trainer_clients")
      .select("trainer_id")
      .eq("client_id", clientId)
      .eq("trainer_id", tenant.trainer_id)
      .neq("status", "archived")
      .maybeSingle();
    if (link) return link.trainer_id;
  }
  const { data } = await supabase
    .from("trainer_clients")
    .select("trainer_id")
    .eq("client_id", clientId)
    .neq("status", "archived")
    .order("started_at")
    .limit(1)
    .maybeSingle();
  return data?.trainer_id ?? null;
});
