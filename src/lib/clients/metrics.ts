// Pure helpers for client management and the two dashboards.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// ---------------------------------------------------------------------------
// Time ranges in a viewer's timezone (returned as UTC instants)
// ---------------------------------------------------------------------------

/** "yyyy-MM-dd" of `now` in `tz`. */
export function localDateString(tz: string, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, "yyyy-MM-dd");
}

/** Add whole days to a "yyyy-MM-dd" date string (calendar arithmetic, no DST issues). */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both "yyyy-MM-dd"). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const startOf = (date: string, tz: string) => fromZonedTime(`${date}T00:00:00`, tz);

export function zonedDayRange(tz: string, now: Date = new Date()): { start: Date; end: Date } {
  const today = localDateString(tz, now);
  return { start: startOf(today, tz), end: startOf(addDaysToDateString(today, 1), tz) };
}

/** Monday-to-Monday week containing `now` in `tz`. */
export function zonedWeekRange(tz: string, now: Date = new Date()): { start: Date; end: Date; monday: string } {
  const today = localDateString(tz, now);
  const isoDow = Number(formatInTimeZone(now, tz, "i")); // 1 = Monday .. 7 = Sunday
  const monday = addDaysToDateString(today, -(isoDow - 1));
  return { start: startOf(monday, tz), end: startOf(addDaysToDateString(monday, 7), tz), monday };
}

export function zonedMonthStart(tz: string, now: Date = new Date()): Date {
  return startOf(`${formatInTimeZone(now, tz, "yyyy-MM")}-01`, tz);
}

/** Morning / afternoon / evening greeting for the viewer's local time. */
export function greeting(tz: string, now: Date = new Date()): string {
  const h = Number(formatInTimeZone(now, tz, "H"));
  if (h < 5) return "Hi";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export type LedgerRow = {
  id: string;
  delta: number;
  grant_id: string | null;
  expires_at: string | null;
  session_type_ids: string[] | null;
};

export type CreditBucket = {
  /** null = usable for any session type. */
  sessionTypeIds: string[] | null;
  remaining: number;
  /** Earliest expiry among grants that still have credits left. */
  nextExpiry: string | null;
};

/**
 * Remaining unexpired credits grouped by the session types they're valid for
 * (mirrors the credit_balance SQL function: grant delta minus its debits).
 */
export function creditBuckets(rows: LedgerRow[], now: Date = new Date()): CreditBucket[] {
  const used = new Map<string, number>();
  for (const r of rows) {
    if (r.delta < 0 && r.grant_id) used.set(r.grant_id, (used.get(r.grant_id) ?? 0) - r.delta);
  }
  const buckets = new Map<string, CreditBucket>();
  for (const g of rows) {
    if (g.delta <= 0) continue;
    if (g.expires_at && new Date(g.expires_at) <= now) continue;
    const left = g.delta - (used.get(g.id) ?? 0);
    if (left <= 0) continue;
    const ids = g.session_type_ids && g.session_type_ids.length ? [...g.session_type_ids].sort() : null;
    const key = ids ? ids.join(",") : "*";
    const b = buckets.get(key) ?? { sessionTypeIds: ids, remaining: 0, nextExpiry: null };
    b.remaining += left;
    if (g.expires_at && (!b.nextExpiry || g.expires_at < b.nextExpiry)) b.nextExpiry = g.expires_at;
    buckets.set(key, b);
  }
  // "Any session" first, then by size.
  return [...buckets.values()].sort(
    (a, b) => Number(a.sessionTypeIds !== null) - Number(b.sessionTypeIds !== null) || b.remaining - a.remaining,
  );
}

/** A client "runs low" only if they buy credits at all. */
export function isLowOnCredits(balance: number, everGranted: number): boolean {
  return everGranted > 0 && balance <= 1;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Subscription statuses that count toward recurring revenue. */
export const MRR_STATUSES = ["active", "past_due"] as const;
/** Statuses that mean "has a membership" for display. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;
export const FAILING_SUBSCRIPTION_STATUSES = ["past_due", "unpaid", "incomplete"] as const;

export type RecurringSub = {
  status: string;
  price_cents: number | null;
  billing_interval: "week" | "month" | "year" | null;
  interval_count: number | null;
};

/** Normalised monthly recurring revenue in cents. */
export function monthlyRecurringCents(subs: RecurringSub[]): number {
  let total = 0;
  for (const s of subs) {
    if (!(MRR_STATUSES as readonly string[]).includes(s.status)) continue;
    if (!s.price_cents || !s.billing_interval) continue;
    const count = Math.max(1, s.interval_count ?? 1);
    const perMonth =
      s.billing_interval === "month"
        ? s.price_cents / count
        : s.billing_interval === "year"
          ? s.price_cents / (12 * count)
          : (s.price_cents * 52) / (12 * count);
    total += perMonth;
  }
  return Math.round(total);
}

/** Money actually kept: captured amount minus refunds. */
export function netPaidCents(
  payments: { status: string; amount_cents: number; amount_refunded_cents: number }[],
): number {
  return payments
    .filter((p) => p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded")
    .reduce((sum, p) => sum + Math.max(0, p.amount_cents - p.amount_refunded_cents), 0);
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

/**
 * Week/day of a program on `today` (both "yyyy-MM-dd"); day 1 = the program's
 * start date. Null before the start or after the last week.
 */
export function programPosition(
  startDate: string,
  today: string,
  durationWeeks: number,
): { week: number; day: number } | null {
  const d = daysBetween(startDate, today);
  if (d < 0) return null;
  const week = Math.floor(d / 7) + 1;
  if (week > durationWeeks) return null;
  return { week, day: (d % 7) + 1 };
}

// ---------------------------------------------------------------------------
// Roster helpers
// ---------------------------------------------------------------------------

/** Split a free-form tag input ("vip, Morning crew,  hybrid") into clean unique tags. */
export function parseTags(input: string | null | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 20);
}

export function matchesSearch(
  query: string | null | undefined,
  fields: (string | null | undefined)[],
): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string, now: Date = new Date(), tz = "UTC"): string {
  const secs = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (secs < 0) return formatInTimeZone(iso, tz, "MMM d");
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)}d ago`;
  return formatInTimeZone(iso, tz, "MMM d");
}
