import { formatInTimeZone } from "date-fns-tz";

export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDateTime(iso: string | Date, timeZone: string, pattern = "EEE, MMM d · h:mm a"): string {
  return formatInTimeZone(iso, timeZone, pattern);
}

export function formatDate(iso: string | Date, timeZone: string, pattern = "MMM d, yyyy"): string {
  return formatInTimeZone(iso, timeZone, pattern);
}

export function formatTime(iso: string | Date, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "h:mm a");
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined): string {
  return p?.full_name || p?.email || "Unknown";
}

export const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
