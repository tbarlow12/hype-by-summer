// Pure helpers for "who on the team is responsible for this client" and for
// which exercises a business may use. No I/O: callers load the rows.

export type StaffMember = { user_id: string; role: "owner" | "admin" | "coach" | "staff"; active: boolean };

/**
 * Who hears about a client's training activity (logs, check-ins, feedback):
 * the program's coach if still active staff, else the client's primary coach
 * if still active staff, else the business's owners/admins.
 */
export function responsibleCoachIds(input: {
  programCoachId?: string | null;
  primaryCoachId?: string | null;
  members: StaffMember[];
}): string[] {
  const active = input.members.filter((m) => m.active);
  const isActive = (id: string | null | undefined) => !!id && active.some((m) => m.user_id === id);
  if (isActive(input.programCoachId)) return [input.programCoachId!];
  if (isActive(input.primaryCoachId)) return [input.primaryCoachId!];
  return [...new Set(active.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.user_id))];
}

/** A business may use global exercises (no business) and its own. */
export function exerciseUsableBy(exercise: { business_id: string | null }, businessId: string): boolean {
  return exercise.business_id === null || exercise.business_id === businessId;
}

/** Check-in inbox scope: coaches default to their own clients; managers to everyone. */
export function inboxScope(param: string | string[] | undefined, manager: boolean): "mine" | "all" {
  if (param === "all") return "all";
  if (param === "mine") return "mine";
  return manager ? "all" : "mine";
}
