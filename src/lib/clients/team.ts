import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import type { Role } from "./team-utils";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type TeamMember = {
  userId: string;
  role: Role;
  active: boolean;
  isBookable: boolean;
  title: string | null;
  slug: string | null;
  bio: string | null;
  specialties: string[];
  createdAt: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
};

/** Members of a business (RLS: staff and clients of it), active first, then by name. */
export async function listTeam(supabase: Supabase, businessId: string, { activeOnly = false } = {}): Promise<TeamMember[]> {
  let q = supabase
    .from("business_members")
    .select(
      "user_id, role, active, is_bookable, title, slug, bio, specialties, created_at, profiles!business_members_user_id_fkey(full_name, email, avatar_url)",
    )
    .eq("business_id", businessId);
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) console.error("[team] list failed", error);
  return (data ?? [])
    .map((m) => ({
      userId: m.user_id,
      role: m.role,
      active: m.active,
      isBookable: m.is_bookable,
      title: m.title,
      slug: m.slug,
      bio: m.bio,
      specialties: m.specialties,
      createdAt: m.created_at,
      name: displayName(m.profiles),
      email: m.profiles?.email ?? null,
      avatarUrl: m.profiles?.avatar_url ?? null,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** Members who coach (anyone bookable or with the coach/owner role), for pickers. */
export function coachesOf(team: TeamMember[]): TeamMember[] {
  return team.filter((m) => m.active && (m.isBookable || m.role === "coach" || m.role === "owner"));
}
