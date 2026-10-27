import { formatInTimeZone } from "date-fns-tz";

/** Calendar dates are handled as "YYYY-MM-DD" strings (no time, no zone). */
export type DateStr = string;

const DAY_MS = 86_400_000;

function toUtc(d: DateStr): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, day ?? 1);
}

function fromUtc(ms: number): DateStr {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date in a timezone. */
export function todayInTz(timeZone: string, now: Date = new Date()): DateStr {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** b - a in whole days. */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = Monday .. 6 = Sunday. */
export function isoWeekdayIndex(d: DateStr): number {
  return (new Date(toUtc(d)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing d. */
export function weekStartMonday(d: DateStr): DateStr {
  return addDays(d, -isoWeekdayIndex(d));
}

/** The 7 dates of the week starting at `start`. */
export function weekDates(start: DateStr): DateStr[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Program days are relative to the start date: week 1 day 1 = start_date,
 * week 2 day 1 = start_date + 7, and so on.
 */
export function programWorkoutDate(start: DateStr, week: number, day: number): DateStr {
  return addDays(start, (week - 1) * 7 + (day - 1));
}

/** Where `today` falls in a program (null before the start or after the end). */
export function programPosition(
  start: DateStr,
  durationWeeks: number,
  today: DateStr,
): { week: number; day: number } | null {
  const offset = diffDays(start, today);
  if (offset < 0 || offset >= durationWeeks * 7) return null;
  return { week: Math.floor(offset / 7) + 1, day: (offset % 7) + 1 };
}

/** Short label like "Mon 3" for a date string. */
export function shortDayLabel(d: DateStr): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(toUtc(d)));
}

/** Label like "Jan 7, 2030" for a date string. */
export function longDateLabel(d: DateStr, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(toUtc(d)));
}
