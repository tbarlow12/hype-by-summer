import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import type { Business } from "@/lib/tenant";
import {
  computeTeamSlots,
  groupSlotsByDate,
  parseTstzRange,
  type BusyBookingInput,
  type CoachAvailabilityInput,
  type TeamSlot,
  type TeamSlotDay,
} from "./slots";

// Server-side availability: loads a business's coaches, their hours, time off
// and busy bookings (service role, always scoped by the business id the
// caller resolved from the host or an authorized row) and feeds the pure
// slot engine.

export type SessionType = Tables<"session_types">;

/** Statuses that occupy calendar time (pending holds are filtered by expiry). */
const BUSY_STATUSES = ["confirmed", "completed", "no_show", "pending_payment"] as const;
const DAY = 86_400_000;

/** A coach (staff member) of a business as the booking engine and pages see them. */
export type Coach = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  slug: string | null;
  timezone: string;
  isBookable: boolean;
  role: Tables<"business_members">["role"];
};

/** Active staff of a business (optionally only bookable ones), sorted by name. */
export async function listCoaches(businessId: string, opts: { bookableOnly?: boolean } = {}): Promise<Coach[]> {
  let query = createAdminClient()
    .from("business_members")
    .select("user_id, role, slug, title, bio, is_bookable, profiles!business_members_user_id_fkey(full_name, email, avatar_url, timezone)")
    .eq("business_id", businessId)
    .eq("active", true);
  if (opts.bookableOnly) query = query.eq("is_bookable", true);
  const { data } = await query;
  return (data ?? [])
    .map((m) => ({
      id: m.user_id,
      name: m.profiles?.full_name || m.profiles?.email || "Coach",
      email: m.profiles?.email ?? "",
      avatarUrl: m.profiles?.avatar_url ?? null,
      title: m.title,
      bio: m.bio,
      slug: m.slug,
      timezone: m.profiles?.timezone ?? "America/Denver",
      isBookable: m.is_bookable,
      role: m.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One active staff member of a business, or null. */
export async function getCoach(businessId: string, coachId: string): Promise<Coach | null> {
  const coaches = await listCoaches(businessId);
  return coaches.find((c) => c.id === coachId) ?? null;
}

/** Bookable coaches who run this session type, in the type's coach order. */
export function coachesForType(sessionType: Pick<SessionType, "coach_ids">, coaches: Coach[]): Coach[] {
  const byId = new Map(coaches.filter((c) => c.isBookable).map((c) => [c.id, c]));
  return sessionType.coach_ids.map((id) => byId.get(id)).filter((c): c is Coach => Boolean(c));
}

/**
 * Hours, time off and busy bookings per coach for [from, to). Rules and
 * overrides are this business's (closures with coach_id null apply to
 * everyone); busy bookings are the coach's at any business, matching the
 * reserve_booking RPC's conflict check.
 */
export async function loadCoachAvailability(
  businessId: string,
  coaches: Pick<Coach, "id" | "timezone">[],
  from: Date,
  to: Date,
): Promise<CoachAvailabilityInput[]> {
  if (coaches.length === 0) return [];
  const admin = createAdminClient();
  const ids = coaches.map((c) => c.id);
  const marginFrom = new Date(from.getTime() - DAY).toISOString();
  const marginTo = new Date(to.getTime() + DAY).toISOString();
  const [{ data: rules }, { data: overrides }, { data: bookings }] = await Promise.all([
    admin
      .from("availability_rules")
      .select("coach_id, weekday, start_time, end_time, session_type_ids")
      .eq("business_id", businessId)
      .in("coach_id", ids),
    admin
      .from("availability_overrides")
      .select("coach_id, starts_at, ends_at, is_available")
      .eq("business_id", businessId)
      .or(`coach_id.is.null,coach_id.in.(${ids.join(",")})`)
      .lt("starts_at", marginTo)
      .gt("ends_at", marginFrom),
    admin
      .from("bookings")
      .select("id, coach_id, session_type_id, starts_at, blocked_range, status, hold_expires_at")
      .in("coach_id", ids)
      .in("status", [...BUSY_STATUSES])
      .lt("starts_at", marginTo)
      .gt("ends_at", marginFrom),
  ]);
  const now = Date.now();
  const busyByCoach = new Map<string, BusyBookingInput[]>();
  for (const b of bookings ?? []) {
    if (b.status === "pending_payment" && (!b.hold_expires_at || Date.parse(b.hold_expires_at) <= now)) continue;
    const range = parseTstzRange(b.blocked_range);
    if (!range) continue;
    const list = busyByCoach.get(b.coach_id) ?? [];
    list.push({ id: b.id, session_type_id: b.session_type_id, starts_at: b.starts_at, blocked_start: range.start, blocked_end: range.end });
    busyByCoach.set(b.coach_id, list);
  }
  return coaches.map((c) => ({
    coachId: c.id,
    timezone: c.timezone,
    rules: (rules ?? []).filter((r) => r.coach_id === c.id),
    overrides: (overrides ?? []).filter((o) => o.coach_id === null || o.coach_id === c.id),
    busy: busyByCoach.get(c.id) ?? [],
  }));
}

export type SlotQuery = {
  businessId: string;
  sessionType: SessionType;
  /** Bookable coaches of the business (from listCoaches) to consider. */
  coaches: Coach[];
  /** One coach, or null for "any available coach" (union). */
  coachId: string | null;
  from: Date;
  to: Date;
  displayTimezone: string;
  excludeBookingId?: string;
  includeFull?: boolean;
  now?: Date;
};

/** Offered slots for a session type with one coach or any of its coaches. */
export async function getSlots(input: SlotQuery): Promise<{ slots: TeamSlot[]; days: TeamSlotDay[] }> {
  const eligible = coachesForType(input.sessionType, input.coaches).filter((c) => !input.coachId || c.id === input.coachId);
  const data = await loadCoachAvailability(input.businessId, eligible, input.from, input.to);
  const slots = computeTeamSlots({
    coaches: data,
    sessionType: input.sessionType,
    from: input.from,
    to: input.to,
    now: input.now ?? new Date(),
    excludeBookingId: input.excludeBookingId,
    includeFull: input.includeFull,
  });
  return { slots, days: groupSlotsByDate(slots, input.displayTimezone) };
}

/**
 * Whether `startsAt` is currently offered. `coachIds` lists the coaches with
 * a free spot (in session-type order); `full` means only full group classes.
 */
export async function isSlotOffered(
  input: Omit<SlotQuery, "from" | "to" | "displayTimezone" | "includeFull"> & { startsAt: string },
): Promise<{ offered: boolean; full: boolean; coachIds: string[] }> {
  const start = new Date(input.startsAt);
  const { slots } = await getSlots({
    ...input,
    from: start,
    to: new Date(start.getTime() + 60_000),
    displayTimezone: "UTC",
    includeFull: true,
  });
  const match = slots.find((s) => s.start === start.toISOString());
  if (!match) return { offered: false, full: false, coachIds: [] };
  return { offered: match.spotsLeft > 0, full: match.spotsLeft === 0, coachIds: match.coachIds };
}

/**
 * Session types a viewer may book at a business. Public visitors see active,
 * non-clients-only types; the business's clients also see clients_only ones.
 * Types with no bookable coach are left out.
 */
export async function listBookableSessionTypes(
  businessId: string,
  opts: { includeClientsOnly: boolean; coaches: Coach[] },
): Promise<SessionType[]> {
  let query = createAdminClient().from("session_types").select("*").eq("business_id", businessId).eq("active", true);
  if (!opts.includeClientsOnly) query = query.eq("clients_only", false);
  const { data } = await query.order("sort_order").order("name");
  return (data ?? []).filter((st) => coachesForType(st, opts.coaches).length > 0);
}

export async function getBookableSessionType(businessId: string, slug: string, opts: { includeClientsOnly: boolean }) {
  const { data } = await createAdminClient()
    .from("session_types")
    .select("*")
    .eq("business_id", businessId)
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  if (data.clients_only && !opts.includeClientsOnly) return null;
  return data;
}

/** A person's (non-archived) client relationship with a business, if any. */
export async function clientRelationship(clientId: string, businessId: string) {
  const { data } = await createAdminClient()
    .from("business_clients")
    .select("client_id, primary_coach_id, status")
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .neq("status", "archived")
    .maybeSingle();
  return data;
}

export async function isClientOf(clientId: string, businessId: string): Promise<boolean> {
  return Boolean(await clientRelationship(clientId, businessId));
}

export async function creditBalance(clientId: string, businessId: string, sessionTypeId: string): Promise<number> {
  const { data } = await createAdminClient().rpc("credit_balance", { p_client: clientId, p_business: businessId, p_session_type: sessionTypeId });
  return data ?? 0;
}

/** The cancellation policy lives on the business. */
export function policyOf(business: Pick<Business, "cancellation_window_hours" | "late_cancel_fee_cents" | "no_show_fee_cents" | "refund_on_cancel">) {
  return {
    cancellation_window_hours: business.cancellation_window_hours,
    late_cancel_fee_cents: business.late_cancel_fee_cents,
    no_show_fee_cents: business.no_show_fee_cents,
    refund_on_cancel: business.refund_on_cancel,
  };
}
