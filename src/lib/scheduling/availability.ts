import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { computeSlots, groupSlotsByDate, parseTstzRange, type BusyBookingInput, type Slot, type SlotDay } from "./slots";

export type SessionType = Tables<"session_types">;

/** Statuses that occupy calendar time (pending holds are filtered by expiry). */
const BUSY_STATUSES = ["confirmed", "completed", "no_show", "pending_payment"] as const;
const DAY = 86_400_000;

/** Public trainer data the booking engine needs (timezone + policy). Admin client; no secrets returned. */
export async function getTrainerSchedulingInfo(trainerId: string) {
  const admin = createAdminClient();
  const [{ data: profile }, { data: storefront }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, timezone, avatar_url").eq("id", trainerId).maybeSingle(),
    admin
      .from("trainer_profiles")
      .select("trainer_id, slug, business_name, default_location, cancellation_window_hours, late_cancel_fee_cents, no_show_fee_cents, refund_on_cancel, reminder_hours")
      .eq("trainer_id", trainerId)
      .maybeSingle(),
  ]);
  if (!profile || !storefront) return null;
  return { ...storefront, full_name: profile.full_name, email: profile.email, timezone: profile.timezone, avatar_url: profile.avatar_url };
}

export type TrainerSchedulingInfo = NonNullable<Awaited<ReturnType<typeof getTrainerSchedulingInfo>>>;

/** Loads rules, overrides and busy bookings for [from, to) (admin client, scoped to one trainer). */
export async function loadAvailabilityData(trainerId: string, from: Date, to: Date) {
  const admin = createAdminClient();
  const marginFrom = new Date(from.getTime() - DAY).toISOString();
  const marginTo = new Date(to.getTime() + DAY).toISOString();
  const [{ data: rules }, { data: overrides }, { data: bookings }] = await Promise.all([
    admin.from("availability_rules").select("weekday, start_time, end_time, session_type_ids").eq("trainer_id", trainerId),
    admin
      .from("availability_overrides")
      .select("starts_at, ends_at, is_available")
      .eq("trainer_id", trainerId)
      .lt("starts_at", marginTo)
      .gt("ends_at", marginFrom),
    admin
      .from("bookings")
      .select("id, session_type_id, starts_at, blocked_range, status, hold_expires_at")
      .eq("trainer_id", trainerId)
      .in("status", [...BUSY_STATUSES])
      .lt("starts_at", marginTo)
      .gt("ends_at", marginFrom),
  ]);
  const now = Date.now();
  const busy: BusyBookingInput[] = [];
  for (const b of bookings ?? []) {
    if (b.status === "pending_payment" && (!b.hold_expires_at || Date.parse(b.hold_expires_at) <= now)) continue;
    const range = parseTstzRange(b.blocked_range);
    if (!range) continue;
    busy.push({ id: b.id, session_type_id: b.session_type_id, starts_at: b.starts_at, blocked_start: range.start, blocked_end: range.end });
  }
  return { rules: rules ?? [], overrides: overrides ?? [], busy };
}

export async function getSlots(input: {
  trainerId: string;
  timezone: string;
  sessionType: SessionType;
  from: Date;
  to: Date;
  displayTimezone?: string;
  excludeBookingId?: string;
  includeFull?: boolean;
  now?: Date;
}): Promise<{ slots: Slot[]; days: SlotDay[] }> {
  const data = await loadAvailabilityData(input.trainerId, input.from, input.to);
  const slots = computeSlots({
    timezone: input.timezone,
    rules: data.rules,
    overrides: data.overrides,
    busy: data.busy,
    sessionType: input.sessionType,
    from: input.from,
    to: input.to,
    now: input.now ?? new Date(),
    excludeBookingId: input.excludeBookingId,
    includeFull: input.includeFull,
  });
  return { slots, days: groupSlotsByDate(slots, input.displayTimezone ?? input.timezone) };
}

/** True when `startsAt` is currently offered (with at least one spot) for this session type. */
export async function isSlotOffered(input: {
  trainerId: string;
  timezone: string;
  sessionType: SessionType;
  startsAt: string;
  excludeBookingId?: string;
}): Promise<{ offered: boolean; full: boolean }> {
  const start = new Date(input.startsAt);
  const { slots } = await getSlots({
    trainerId: input.trainerId,
    timezone: input.timezone,
    sessionType: input.sessionType,
    from: start,
    to: new Date(start.getTime() + 60_000),
    excludeBookingId: input.excludeBookingId,
    includeFull: true,
  });
  const match = slots.find((s) => s.start === start.toISOString());
  return { offered: Boolean(match && match.spotsLeft > 0), full: Boolean(match && match.spotsLeft === 0) };
}

/**
 * Session types a viewer may book with this trainer. Public visitors see
 * active, non-members-only types; the trainer's own clients also see
 * clients_only ones.
 */
export async function listBookableSessionTypes(trainerId: string, opts: { includeClientsOnly: boolean }): Promise<SessionType[]> {
  const admin = createAdminClient();
  let query = admin.from("session_types").select("*").eq("trainer_id", trainerId).eq("active", true);
  if (!opts.includeClientsOnly) query = query.eq("clients_only", false);
  const { data } = await query.order("sort_order").order("name");
  return data ?? [];
}

export async function getBookableSessionType(trainerId: string, slug: string, opts: { includeClientsOnly: boolean }) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("session_types")
    .select("*")
    .eq("trainer_id", trainerId)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  if (data.clients_only && !opts.includeClientsOnly) return null;
  return data;
}

/** Whether a user is an (active) client of a trainer. Admin client; ids come from the verified session. */
export async function isClientOfTrainer(clientId: string, trainerId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("trainer_clients")
    .select("client_id")
    .eq("trainer_id", trainerId)
    .eq("client_id", clientId)
    .neq("status", "archived")
    .maybeSingle();
  return Boolean(data);
}

export async function creditBalance(clientId: string, trainerId: string, sessionTypeId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("credit_balance", { p_client: clientId, p_trainer: trainerId, p_session_type: sessionTypeId });
  return data ?? 0;
}
