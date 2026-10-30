import "server-only";
import { isManager, requireStaff, type Membership, type StaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Authorization helpers for the coach-side scheduling pages and actions.

/**
 * Who may change a booking: managers (owner/admin), front-desk staff, and the
 * coach the booking is assigned to. Every staff member may view the team calendar.
 */
export function canActOnBooking(membership: Pick<Membership, "role" | "user_id">, booking: { coach_id: string }): boolean {
  return isManager(membership) || membership.role === "staff" || booking.coach_id === membership.user_id;
}

/** Whether this staff member may edit a coach's availability (their own, or anyone's for managers). */
export function canEditAvailability(membership: Pick<Membership, "role" | "user_id">, coachId: string | null): boolean {
  if (coachId === null) return isManager(membership); // business-wide closures
  return isManager(membership) || membership.user_id === coachId;
}

/** A booking of the current business (RLS + explicit business filter), with the staff context. */
export async function staffBooking(id: string): Promise<{ staff: StaffContext; booking: { id: string; coach_id: string; business_id: string }; canAct: boolean } | null> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("id, coach_id, business_id")
    .eq("id", id)
    .eq("business_id", staff.business.id)
    .maybeSingle();
  if (!data) return null;
  return { staff, booking: data, canAct: canActOnBooking(staff.membership, data) };
}

/** Distinct, readable colors for coaches on the team calendar (by position). */
export const COACH_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0891b2", "#65a30d", "#dc2626", "#4f46e5", "#0d9488"];

export function coachColor(index: number): string {
  return COACH_COLORS[((index % COACH_COLORS.length) + COACH_COLORS.length) % COACH_COLORS.length]!;
}
