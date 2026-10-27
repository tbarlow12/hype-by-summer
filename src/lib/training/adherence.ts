export type WeekAdherence = { week: number; prescribed: number; completed: number; pct: number | null };

/**
 * % of prescribed workouts completed per week. A workout counts once no matter
 * how many times it was logged. Weeks with nothing prescribed have pct null.
 */
export function adherenceByWeek(
  workouts: { id: string; week: number }[],
  loggedWorkoutIds: (string | null)[],
  durationWeeks: number,
): WeekAdherence[] {
  const logged = new Set(loggedWorkoutIds.filter((id): id is string => !!id));
  const weeks: WeekAdherence[] = Array.from({ length: durationWeeks }, (_, i) => ({
    week: i + 1,
    prescribed: 0,
    completed: 0,
    pct: null,
  }));
  for (const w of workouts) {
    const row = weeks[w.week - 1];
    if (!row) continue;
    row.prescribed += 1;
    if (logged.has(w.id)) row.completed += 1;
  }
  for (const row of weeks) row.pct = row.prescribed ? Math.round((row.completed / row.prescribed) * 100) : null;
  return weeks;
}

/** Overall adherence through `throughWeek` (inclusive); null when nothing was due yet. */
export function overallAdherence(weeks: WeekAdherence[], throughWeek: number): number | null {
  let prescribed = 0;
  let completed = 0;
  for (const w of weeks) {
    if (w.week > throughWeek) break;
    prescribed += w.prescribed;
    completed += w.completed;
  }
  return prescribed ? Math.round((completed / prescribed) * 100) : null;
}

export type FeedbackFlag = { kind: "pain" | "too_hard" | "too_easy" | "low_energy"; label: string };

/**
 * Coaching flags from recent workout logs (newest first): any pain in the
 * window, and difficulty trends (2+ of the last 3 rated sessions at 4-5 =
 * too hard, or 1-2 = too easy).
 */
export function feedbackFlags(
  logs: { difficulty_rating: number | null; pain_flag: boolean; energy_level?: number | null }[],
  window = 5,
): FeedbackFlag[] {
  const recent = logs.slice(0, window);
  const flags: FeedbackFlag[] = [];
  const pain = recent.filter((l) => l.pain_flag).length;
  if (pain) flags.push({ kind: "pain", label: `Pain reported in ${pain} of the last ${recent.length} sessions` });
  const rated = recent.filter((l) => l.difficulty_rating != null).slice(0, 3);
  if (rated.length >= 2) {
    const hard = rated.filter((l) => l.difficulty_rating! >= 4).length;
    const easy = rated.filter((l) => l.difficulty_rating! <= 2).length;
    if (hard >= 2) flags.push({ kind: "too_hard", label: "Trending too hard" });
    if (easy >= 2) flags.push({ kind: "too_easy", label: "Trending too easy" });
  }
  const energy = recent.filter((l) => l.energy_level != null).slice(0, 3);
  if (energy.length >= 2 && energy.filter((l) => l.energy_level! <= 2).length >= 2) {
    flags.push({ kind: "low_energy", label: "Low energy lately" });
  }
  return flags;
}

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Too easy",
  2: "A bit easy",
  3: "Just right",
  4: "A bit hard",
  5: "Too hard",
};
