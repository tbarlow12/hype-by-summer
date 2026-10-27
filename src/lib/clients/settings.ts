// Trainer settings helpers.

/** Reminder lead times offered in settings (hours before a session). */
export const REMINDER_HOUR_OPTIONS = [1, 2, 4, 12, 24, 48, 72] as const;

/** Comma / newline separated list -> trimmed unique entries. */
export function parseList(input: string | null | undefined, max = 20): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const v = raw.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.slice(0, max);
}

export function reminderLabel(h: number): string {
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = h / 24;
  return `${d} day${d === 1 ? "" : "s"}`;
}
