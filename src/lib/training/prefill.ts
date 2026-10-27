export type PrefillSet = {
  set_number: number;
  reps: number | null;
  weight: number | null;
  weight_unit: "lb" | "kg";
  duration_seconds: number | null;
  rpe: number | null;
};

/** "8-10" -> 8, "12" -> 12, "AMRAP" / "max" -> null. Seconds like "30s" are not reps. */
export function parseRepTarget(reps: string | null | undefined): number | null {
  if (!reps) return null;
  if (/\d+\s*(s|sec|secs|seconds|min|m)\b/i.test(reps)) return null;
  const m = reps.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** "30s" -> 30, "1 min" -> 60, "45 sec" -> 45. */
export function parseDurationTarget(reps: string | null | undefined): number | null {
  if (!reps) return null;
  const sec = reps.match(/(\d+)\s*(s|sec|secs|seconds)\b/i);
  if (sec) return Number(sec[1]);
  const min = reps.match(/(\d+(?:\.\d+)?)\s*(min|m)\b/i);
  if (min) return Math.round(Number(min[1]) * 60);
  return null;
}

/** "135 lb" -> {weight 135, lb}; "60kg" -> kg; "RPE 8" -> {rpe 8}; "70% 1RM" -> nothing usable. */
export function parseLoad(load: string | null | undefined): {
  weight: number | null;
  unit: "lb" | "kg" | null;
  rpe: number | null;
} {
  const empty = { weight: null, unit: null, rpe: null };
  if (!load) return empty;
  const rpe = load.match(/rpe\s*(\d+(?:\.\d+)?)/i);
  if (rpe) return { ...empty, rpe: Number(rpe[1]) };
  if (/%/.test(load)) return empty;
  const w = load.match(/(\d+(?:\.\d+)?)\s*(lbs?|kg|kgs)?\b/i);
  if (!w) return empty;
  const unit = w[2]?.toLowerCase().startsWith("kg") ? "kg" : w[2] ? "lb" : null;
  return { weight: Number(w[1]), unit, rpe: null };
}

/**
 * Starting values for each prescribed set: the client's last performance of
 * the exercise wins (same set number, else their last set), otherwise the
 * prescription.
 */
export function buildPrefill(
  prescription: { sets: number; reps: string | null; load: string | null },
  lastSets: { set_number: number; reps: number | null; weight: number | null; weight_unit: string; duration_seconds?: number | null }[],
  defaultUnit: "lb" | "kg" = "lb",
): PrefillSet[] {
  const reps = parseRepTarget(prescription.reps);
  const duration = parseDurationTarget(prescription.reps);
  const load = parseLoad(prescription.load);
  const sortedLast = [...lastSets].sort((a, b) => a.set_number - b.set_number);
  return Array.from({ length: Math.max(1, prescription.sets) }, (_, i) => {
    const last = sortedLast.find((s) => s.set_number === i + 1) ?? sortedLast[sortedLast.length - 1];
    const unit = (last?.weight != null ? last.weight_unit : load.unit) ?? defaultUnit;
    return {
      set_number: i + 1,
      reps: reps ?? last?.reps ?? null,
      weight: last?.weight != null ? Number(last.weight) : load.weight,
      weight_unit: unit === "kg" ? "kg" : "lb",
      duration_seconds: duration ?? last?.duration_seconds ?? null,
      rpe: load.rpe,
    };
  });
}

/** "95lb×8, 100lb×8" style summary of logged sets. */
export function summarizeSets(
  sets: { reps: number | null; weight: number | null; weight_unit: string; duration_seconds?: number | null }[],
): string {
  return sets
    .map((s) =>
      s.weight != null && s.reps != null
        ? `${Number(s.weight)}${s.weight_unit}×${s.reps}`
        : s.reps != null
          ? `${s.reps} reps`
          : s.duration_seconds != null
            ? `${s.duration_seconds}s`
            : "–",
    )
    .join(", ");
}
