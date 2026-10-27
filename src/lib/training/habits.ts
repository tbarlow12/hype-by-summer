import { addDays, type DateStr } from "./dates";

/**
 * Consecutive logged days ending today, or ending yesterday when today isn't
 * ticked yet (so the streak doesn't look broken first thing in the morning).
 */
export function currentStreak(logged: DateStr[], today: DateStr): number {
  const set = new Set(logged);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

/** Longest run of consecutive logged days. */
export function bestStreak(logged: DateStr[]): number {
  const days = [...new Set(logged)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Days logged within the 7 days starting at weekStart. */
export function countInWeek(logged: DateStr[], weekStart: DateStr): number {
  const end = addDays(weekStart, 6);
  return new Set(logged.filter((d) => d >= weekStart && d <= end)).size;
}

/** Goal progress 0-100 (handles goals where the target is below the start, e.g. weight loss). */
export function goalProgress(goal: {
  start_value?: number | null;
  current_value: number | null;
  target_value: number | null;
}): number | null {
  const { current_value: cur, target_value: target } = goal;
  if (cur == null || target == null) return null;
  const start = goal.start_value;
  if (start != null && start !== target) {
    const pct = ((cur - start) / (target - start)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
  if (target === 0) return cur === 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((cur / target) * 100)));
}
