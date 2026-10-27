/** Estimated one-rep max (Epley): w × (1 + reps / 30). One rep is the weight itself. */
export function epley1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return round1(weight);
  return round1(weight * (1 + reps / 30));
}

export const KG_TO_LB = 2.20462;

const round1 = (n: number) => Math.round(n * 10) / 10;

export type LoggedSet = {
  exercise_id: string;
  exercise_name: string;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  completed: boolean;
  performed_on: string;
};

export type PersonalRecord = {
  exercise_id: string;
  exercise_name: string;
  /** Heaviest completed set (ties broken by more reps). */
  heaviest: { weight: number; reps: number; unit: string; performed_on: string };
  /** Set with the best estimated 1RM. */
  best1RM: { weight: number; reps: number; unit: string; estimate: number; performed_on: string };
  /** Most reps in one set at any weight. */
  mostReps: number;
};

function inLb(weight: number, unit: string) {
  return unit === "kg" ? weight * KG_TO_LB : weight;
}

/**
 * Personal records per exercise from logged sets. Only completed sets with a
 * positive weight and reps count. kg and lb sets are compared in lb but
 * reported in the unit they were logged in.
 */
export function computePersonalRecords(sets: LoggedSet[]): PersonalRecord[] {
  const byExercise = new Map<string, PersonalRecord>();
  for (const s of sets) {
    if (!s.completed || !s.weight || !s.reps || s.weight <= 0 || s.reps <= 0) continue;
    const weight = Number(s.weight);
    const reps = Number(s.reps);
    const estimate = epley1RM(weight, reps);
    const prev = byExercise.get(s.exercise_id);
    if (!prev) {
      byExercise.set(s.exercise_id, {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        heaviest: { weight, reps, unit: s.weight_unit, performed_on: s.performed_on },
        best1RM: { weight, reps, unit: s.weight_unit, estimate, performed_on: s.performed_on },
        mostReps: reps,
      });
      continue;
    }
    const heavyPrev = inLb(prev.heaviest.weight, prev.heaviest.unit);
    const heavyNow = inLb(weight, s.weight_unit);
    if (heavyNow > heavyPrev + 1e-9 || (Math.abs(heavyNow - heavyPrev) < 1e-9 && reps > prev.heaviest.reps)) {
      prev.heaviest = { weight, reps, unit: s.weight_unit, performed_on: s.performed_on };
    }
    if (inLb(estimate, s.weight_unit) > inLb(prev.best1RM.estimate, prev.best1RM.unit) + 1e-9) {
      prev.best1RM = { weight, reps, unit: s.weight_unit, estimate, performed_on: s.performed_on };
    }
    prev.mostReps = Math.max(prev.mostReps, reps);
  }
  return [...byExercise.values()].sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));
}

/** Most recent PRs first (by the date of the best-1RM set). */
export function recentPRs(records: PersonalRecord[], limit = 5): PersonalRecord[] {
  return [...records]
    .sort((a, b) => b.best1RM.performed_on.localeCompare(a.best1RM.performed_on))
    .slice(0, limit);
}
