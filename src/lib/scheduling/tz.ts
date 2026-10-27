import { formatInTimeZone } from "date-fns-tz";

// Pure timezone helpers (no server deps; safe in client components and tests).

const DAY_MS = 86_400_000;

/** "yyyy-MM-dd" for an instant in a timezone. */
export function localDateOf(instant: Date | string | number, timeZone: string): string {
  return formatInTimeZone(new Date(instant), timeZone, "yyyy-MM-dd");
}

/** "HH:mm" for an instant in a timezone. */
export function localTimeOf(instant: Date | string | number, timeZone: string): string {
  return formatInTimeZone(new Date(instant), timeZone, "HH:mm");
}

export function parseDate(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Calendar arithmetic on "yyyy-MM-dd" strings (timezone independent). */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a calendar date. */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** Parses "HH:mm" or "HH:mm:ss" (24:00 allowed) into minutes after midnight. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) throw new Error(`Invalid time ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of a timezone from UTC at an instant, in ms (local = utc + offset). */
export function tzOffsetMs(timeZone: string, instant: number): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
  const floored = instant - (((instant % 1000) + 1000) % 1000);
  return asUtc - floored;
}

/**
 * Converts a wall-clock time in a timezone to a UTC instant. Disambiguates like
 * Temporal's "compatible" mode: times skipped by a DST jump move forward by the
 * gap (02:30 on spring-forward day becomes 03:30), repeated times on fall-back
 * day resolve to the earlier occurrence.
 */
export function zonedTimeToUtc(date: string, minutesAfterMidnight: number, timeZone: string): Date {
  const { y, m, d } = parseDate(date);
  const wall = Date.UTC(y, m - 1, d) + minutesAfterMidnight * 60_000;
  const before = tzOffsetMs(timeZone, wall - DAY_MS);
  const after = tzOffsetMs(timeZone, wall + DAY_MS);
  const candidates = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((t) => tzOffsetMs(timeZone, t) === wall - t)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]!);
  // In a DST gap: use the pre-transition offset, which lands after the gap.
  return new Date(wall - before);
}

/** UTC instant for local midnight at the start of a calendar date. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  return zonedTimeToUtc(date, 0, timeZone);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
