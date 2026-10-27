import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRIMARY_TRAINER_SLUG } from "@/lib/env";
import type { Tables } from "@/lib/supabase/database.types";

export type TrainerProfile = Tables<"trainer_profiles">;

/** Public storefront for a trainer slug (service role; returns public fields + timezone). */
export const getTrainerBySlug = cache(async (slug: string) => {
  const admin = createAdminClient();
  const { data } = await admin
    .from("trainer_profiles")
    .select("*, profiles!trainer_profiles_trainer_id_fkey(full_name, avatar_url, timezone, email)")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const { calendar_feed_token: _secret, ...rest } = data;
  void _secret;
  return rest;
});

/** The business owner whose storefront the homepage shows. Falls back to the first trainer. */
export const getPrimaryTrainer = cache(async () => {
  const bySlug = await getTrainerBySlug(PRIMARY_TRAINER_SLUG);
  if (bySlug) return bySlug;
  const admin = createAdminClient();
  const { data } = await admin.from("trainer_profiles").select("slug").order("created_at").limit(1).maybeSingle();
  return data ? getTrainerBySlug(data.slug) : null;
});

export type PublicTrainer = NonNullable<Awaited<ReturnType<typeof getTrainerBySlug>>>;
