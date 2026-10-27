import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Profile = Tables<"profiles">;

/** Current user's profile, or null when signed out. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  return data;
});

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
 * The trainer a client works with (first active relationship). Most clients
 * have exactly one; the business is built around a single primary trainer.
 */
export const getClientTrainerId = cache(async (clientId: string): Promise<string | null> => {
  const supabase = await createClient();
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
