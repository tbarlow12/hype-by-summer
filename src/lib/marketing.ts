import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrimaryTrainer, type PublicTrainer } from "@/lib/trainer";
import { BRAND_NAME, PRIMARY_TRAINER_SLUG } from "@/lib/env";
import type { Tables } from "@/lib/supabase/database.types";

// OWNER: leads. Public (anonymous) reads for the marketing site. Uses the
// service role so a signed-in trainer previewing the site sees exactly what
// visitors see; every query filters to public rows explicitly.

export type PublicMagnet = Pick<
  Tables<"lead_magnets">,
  | "id"
  | "trainer_id"
  | "slug"
  | "title"
  | "subtitle"
  | "description"
  | "bullet_points"
  | "cover_image_url"
  | "cta_label"
  | "thank_you_message"
  | "ask_phone"
  | "ask_goal"
  | "updated_at"
  | "file_path"
>;

const MAGNET_COLS =
  "id, trainer_id, slug, title, subtitle, description, bullet_points, cover_image_url, cta_label, thank_you_message, ask_phone, ask_goal, updated_at, file_path";

export const getActiveMagnets = cache(async (trainerId: string): Promise<PublicMagnet[]> => {
  const { data } = await createAdminClient()
    .from("lead_magnets")
    .select(MAGNET_COLS)
    .eq("trainer_id", trainerId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  return data ?? [];
});

export const getActiveMagnetBySlug = cache(async (slug: string): Promise<PublicMagnet | null> => {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(slug)) return null;
  const { data } = await createAdminClient()
    .from("lead_magnets")
    .select(MAGNET_COLS)
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();
  return data;
});

export type PublicSessionType = Pick<
  Tables<"session_types">,
  "id" | "slug" | "name" | "description" | "duration_minutes" | "price_cents" | "currency" | "location_type" | "is_consultation" | "capacity" | "color"
>;

export const getPublicSessionTypes = cache(async (trainerId: string): Promise<PublicSessionType[]> => {
  const { data } = await createAdminClient()
    .from("session_types")
    .select("id, slug, name, description, duration_minutes, price_cents, currency, location_type, is_consultation, capacity, color")
    .eq("trainer_id", trainerId)
    .eq("active", true)
    .eq("clients_only", false)
    .order("sort_order")
    .order("created_at");
  return data ?? [];
});

export const getApprovedTestimonials = cache(async (trainerId: string) => {
  const { data } = await createAdminClient()
    .from("testimonials")
    .select("id, author_name, rating, body, created_at")
    .eq("trainer_id", trainerId)
    .eq("approved", true)
    .order("created_at", { ascending: false })
    .limit(9);
  return data ?? [];
});

/** Link to the free consult booking page (falls back to the trainer's booking page). */
export function consultHref(trainer: Pick<PublicTrainer, "slug">, types: PublicSessionType[]): string {
  const consult = types.find((t) => t.is_consultation);
  return consult ? `/book/${trainer.slug}/${consult.slug}` : `/book/${trainer.slug}`;
}

/** Everything the public header/footer needs (cached per request). */
export const getSiteContext = cache(async () => {
  const trainer = await getPrimaryTrainer();
  if (!trainer) return { trainer: null, magnets: [] as PublicMagnet[], types: [] as PublicSessionType[] };
  const [magnets, types] = await Promise.all([getActiveMagnets(trainer.trainer_id), getPublicSessionTypes(trainer.trainer_id)]);
  return { trainer, magnets, types };
});

/** Public display name for the coach (first name preferred in copy). */
export function coachName(trainer: PublicTrainer): { full: string; first: string } {
  const full = trainer.profiles?.full_name?.trim() || trainer.business_name;
  return { full, first: full.split(/\s+/)[0] ?? full };
}

/**
 * Stand-in storefront so the homepage renders fully before the coach has
 * finished setup (the page's own default copy fills headline/bio).
 */
export function placeholderTrainer(): PublicTrainer {
  const now = new Date(0).toISOString();
  return {
    trainer_id: "",
    slug: PRIMARY_TRAINER_SLUG,
    business_name: BRAND_NAME,
    headline: null,
    bio: null,
    specialties: [],
    certifications: [],
    instagram_handle: null,
    website_url: null,
    brand_color: "#e11d48",
    cover_image_url: null,
    default_location: null,
    cancellation_window_hours: 24,
    late_cancel_fee_cents: 0,
    no_show_fee_cents: 0,
    refund_on_cancel: true,
    reminder_hours: [24, 2],
    accepting_new_clients: true,
    created_at: now,
    updated_at: now,
    profiles: { full_name: null, avatar_url: null, timezone: "America/Denver", email: "" },
  };
}
