// Pure team helpers: roles, who may change whom, dashboard scope and the
// per-coach breakdown. Shared by the Team page, server actions and tests.

export type Role = "owner" | "admin" | "coach" | "staff";

export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including appointing other owners." },
  { value: "admin", label: "Admin", description: "Runs the business: settings, payments, team, all clients." },
  { value: "coach", label: "Coach", description: "Trains clients, takes bookings, sees their own revenue." },
  { value: "staff", label: "Staff", description: "Front desk: clients, bookings and messages. Not bookable by default." },
];

export const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

export const isManagerRole = (r: string | null | undefined) => r === "owner" || r === "admin";

/**
 * Can `actor` (role + id) set `target`'s role to `nextRole` / change their
 * activation? Mirrors business_members_guard, plus "don't lock yourself out".
 * Returns an error message or null.
 */
export function teamChangeError(input: {
  actorId: string;
  actorRole: Role;
  targetId: string;
  targetRole: Role;
  nextRole?: Role;
  deactivate?: boolean;
}): string | null {
  const { actorId, actorRole, targetId, targetRole, nextRole, deactivate } = input;
  if (!isManagerRole(actorRole)) return "Only owners and admins manage the team.";
  const touchesOwner = targetRole === "owner" || nextRole === "owner";
  if (touchesOwner && actorRole !== "owner") return "Only an owner can appoint or change owners.";
  if (deactivate && actorId === targetId) return "You can't deactivate yourself. Ask another owner or admin.";
  if (nextRole && actorId === targetId && !isManagerRole(nextRole))
    return "You can't remove your own management access. Ask another owner or admin.";
  return null;
}

/** Roles an actor may hand out when inviting. */
export function invitableRoles(actorRole: Role): Role[] {
  return actorRole === "owner" ? ["owner", "admin", "coach", "staff"] : isManagerRole(actorRole) ? ["admin", "coach", "staff"] : [];
}

/** Dashboard scope: coaches default to their own day; managers to the whole team. */
export function dashboardView(param: string | null | undefined, manager: boolean): "me" | "team" {
  if (param === "me" || param === "team") return param;
  return manager ? "team" : "me";
}

export type CoachRow = {
  coachId: string;
  sessionsToday: number;
  sessionsWeek: number;
  activeClients: number;
  openLeads: number;
  revenueCents: number | null;
};

/** Per-coach numbers from flat rows (null revenue when the viewer can't see money). */
export function coachBreakdown(input: {
  coachIds: string[];
  today: { coach_id: string }[];
  week: { coach_id: string }[];
  clients: { primary_coach_id: string | null; status: string }[];
  leads: { assigned_coach_id: string | null }[];
  revenue?: { coach_id: string | null; net_cents: number | null }[] | null;
}): CoachRow[] {
  const count = <T,>(rows: T[], key: (r: T) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const today = count(input.today, (r) => r.coach_id);
  const week = count(input.week, (r) => r.coach_id);
  const clients = count(input.clients.filter((c) => c.status === "active"), (r) => r.primary_coach_id);
  const leads = count(input.leads, (r) => r.assigned_coach_id);
  const revenue = new Map<string, number>();
  for (const r of input.revenue ?? []) if (r.coach_id) revenue.set(r.coach_id, (revenue.get(r.coach_id) ?? 0) + (r.net_cents ?? 0));
  return input.coachIds.map((id) => ({
    coachId: id,
    sessionsToday: today.get(id) ?? 0,
    sessionsWeek: week.get(id) ?? 0,
    activeClients: clients.get(id) ?? 0,
    openLeads: leads.get(id) ?? 0,
    revenueCents: input.revenue ? (revenue.get(id) ?? 0) : null,
  }));
}

/** Coach profile slug: "Summer Smith" -> "summer-smith". */
export function slugify(input: string, max = 40): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}
