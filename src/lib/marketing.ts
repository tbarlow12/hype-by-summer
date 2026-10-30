import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBusiness, type Business } from "@/lib/tenant";
import type { Tables } from "@/lib/supabase/database.types";

// OWNER: leads. Public (anonymous) reads for a business's own site. RLS gives
// anon nothing, so these use the service role and EVERY query is scoped to
// the business resolved from the host (requireBusiness) and to public rows.

export type PublicMagnet = Pick<
  Tables<"lead_magnets">,
  | "id"
  | "business_id"
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
  "id, business_id, slug, title, subtitle, description, bullet_points, cover_image_url, cta_label, thank_you_message, ask_phone, ask_goal, updated_at, file_path";

export const getActiveMagnets = cache(async (businessId: string): Promise<PublicMagnet[]> => {
  const { data } = await createAdminClient()
    .from("lead_magnets")
    .select(MAGNET_COLS)
    .eq("business_id", businessId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  return data ?? [];
});

export const getActiveMagnetBySlug = cache(async (businessId: string, slug: string): Promise<PublicMagnet | null> => {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(slug)) return null;
  const { data } = await createAdminClient()
    .from("lead_magnets")
    .select(MAGNET_COLS)
    .eq("business_id", businessId)
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();
  return data;
});

export type PublicSessionType = Pick<
  Tables<"session_types">,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "duration_minutes"
  | "price_cents"
  | "currency"
  | "location_type"
  | "is_consultation"
  | "capacity"
  | "color"
  | "coach_ids"
>;

export const getPublicSessionTypes = cache(async (businessId: string): Promise<PublicSessionType[]> => {
  const { data } = await createAdminClient()
    .from("session_types")
    .select("id, slug, name, description, duration_minutes, price_cents, currency, location_type, is_consultation, capacity, color, coach_ids")
    .eq("business_id", businessId)
    .eq("active", true)
    .eq("clients_only", false)
    .order("sort_order")
    .order("created_at");
  return data ?? [];
});

export const getApprovedTestimonials = cache(async (businessId: string) => {
  const { data } = await createAdminClient()
    .from("testimonials")
    .select("id, author_name, rating, body, created_at, coach_id")
    .eq("business_id", businessId)
    .eq("approved", true)
    .order("created_at", { ascending: false })
    .limit(9);
  return data ?? [];
});

export type PublicCoach = {
  userId: string;
  slug: string | null;
  name: string;
  firstName: string;
  title: string | null;
  bio: string | null;
  specialties: string[];
  avatarUrl: string | null;
  role: Tables<"business_members">["role"];
};

/** The business's bookable coaches (owner first), for the homepage team section. */
export const getPublicCoaches = cache(async (businessId: string): Promise<PublicCoach[]> => {
  const { data } = await createAdminClient()
    .from("business_members")
    .select("user_id, role, slug, title, bio, specialties, created_at, profiles!business_members_user_id_fkey(full_name, avatar_url)")
    .eq("business_id", businessId)
    .eq("active", true)
    .eq("is_bookable", true)
    .in("role", ["owner", "admin", "coach"])
    .order("created_at");
  const rank = { owner: 0, admin: 1, coach: 2, staff: 3 } as const;
  return (data ?? [])
    .map((m) => {
      const name = m.profiles?.full_name?.trim() || "Coach";
      return {
        userId: m.user_id,
        slug: m.slug,
        name,
        firstName: name.split(/\s+/)[0] ?? name,
        title: m.title,
        bio: m.bio,
        specialties: m.specialties,
        avatarUrl: m.profiles?.avatar_url ?? null,
        role: m.role,
      };
    })
    .sort((a, b) => rank[a.role] - rank[b.role]);
});

/** Booking page for one coach of the current business. */
export function coachBookHref(coach: Pick<PublicCoach, "slug">): string {
  return coach.slug ? `/book?coach=${encodeURIComponent(coach.slug)}` : "/book";
}

/** Booking page for a session type of the current business. */
export function sessionBookHref(business: Pick<Business, "slug">, type: Pick<PublicSessionType, "slug">): string {
  return `/book/${business.slug}/${type.slug}`;
}

/** Link to the free consult booking page (falls back to the business's booking page). */
export function consultHref(business: Pick<Business, "slug">, types: PublicSessionType[]): string {
  const consult = types.find((t) => t.is_consultation);
  return consult ? sessionBookHref(business, consult) : "/book";
}

/** Everything the public header/footer/pages need for the host's business (cached per request; 404s otherwise). */
export const getSiteContext = cache(async () => {
  const business = await requireBusiness();
  const [magnets, types, coaches] = await Promise.all([
    getActiveMagnets(business.id),
    getPublicSessionTypes(business.id),
    getPublicCoaches(business.id),
  ]);
  return { business, magnets, types, coaches };
});

/** How the site refers to whoever does the coaching: the solo coach's first name, else the business. */
export function voice(business: Pick<Business, "name">, coaches: PublicCoach[]): { solo: boolean; who: string; whoFull: string } {
  const solo = coaches.length <= 1;
  const coach = coaches[0];
  if (solo && coach && coach.name !== "Coach") return { solo, who: coach.firstName, whoFull: coach.name };
  return { solo, who: business.name, whoFull: business.name };
}
