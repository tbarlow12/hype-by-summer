import { LEAD_SOURCES, LEAD_STATUSES, type LeadSource, type LeadStatus } from "./options";

// CRM list filters parsed from URL search params (shared by the page and CSV export). Pure.

export const SORTS = ["newest", "oldest", "score", "follow_up", "name"] as const;
export type LeadSort = (typeof SORTS)[number];
export const DUE_FILTERS = ["overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export type LeadFilters = {
  status?: LeadStatus;
  source?: LeadSource;
  magnet?: string;
  campaign?: string;
  due?: DueFilter;
  q?: string;
  sort: LeadSort;
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function get(params: Params, key: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v?.trim() || undefined;
}

const oneOf = <T extends string>(list: readonly T[], v: string | undefined): T | undefined =>
  v && (list as readonly string[]).includes(v) ? (v as T) : undefined;

export function parseLeadFilters(params: Params): LeadFilters {
  const magnet = get(params, "magnet");
  // Search text is used inside a PostgREST or() filter: keep it to safe characters.
  const q = get(params, "q")?.replace(/[^\p{L}\p{N}@.+\-_' ]/gu, "").slice(0, 80) || undefined;
  return {
    status: oneOf(LEAD_STATUSES, get(params, "status")),
    source: oneOf(LEAD_SOURCES, get(params, "source")),
    magnet: magnet && UUID.test(magnet) ? magnet : undefined,
    campaign: get(params, "campaign")?.slice(0, 100),
    due: oneOf(DUE_FILTERS, get(params, "due")),
    q,
    sort: oneOf(SORTS, get(params, "sort")) ?? "newest",
  };
}

/** Serialize back to a query string (omits defaults) for links/export. */
export function filtersToQuery(filters: Partial<LeadFilters>, extra: Record<string, string | undefined> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (!v || (k === "sort" && v === "newest")) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Upper bound for follow-up filters (`endOfToday` in the trainer's zone); `none` = no follow-up set. */
export function dueWindow(due: DueFilter, now: Date, endOfToday?: Date): { before?: string; none?: true } {
  const endOfDay = endOfToday ?? new Date(now);
  if (!endOfToday) endOfDay.setUTCHours(23, 59, 59, 999);
  switch (due) {
    case "overdue":
      return { before: now.toISOString() };
    case "today":
      return { before: endOfDay.toISOString() };
    case "week":
      return { before: new Date(now.getTime() + 7 * 86400000).toISOString() };
    case "none":
      return { none: true };
  }
}

export const hasActiveFilters = (f: LeadFilters) =>
  Boolean(f.status || f.source || f.magnet || f.campaign || f.due || f.q);
