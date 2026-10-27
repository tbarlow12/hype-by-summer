import "server-only";
import { buildPrefill, summarizeSets } from "@/lib/training/prefill";
import { longDateLabel } from "@/lib/training/dates";
import type { ExerciseLite, LastSet, WorkoutRow } from "@/lib/training/server";
import type { LoggerBlock, LoggerExercise } from "./workout-logger";

export function toLoggerExercise(e: ExerciseLite): LoggerExercise {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    demo_video_url: e.demo_video_url,
    coaching_cues: e.coaching_cues,
    instructions: e.instructions,
    is_unilateral: e.is_unilateral,
  };
}

/** Logger blocks for a program workout, prefilled from the client's last performance. */
export function blocksForWorkout(
  workout: WorkoutRow,
  last: Map<string, { performed_on: string; sets: LastSet[] }>,
  defaultUnit: "lb" | "kg",
): LoggerBlock[] {
  const counts = new Map<string, number>();
  return workout.exercises.map((we) => {
    let superset: string | null = null;
    if (we.superset_group) {
      const n = (counts.get(we.superset_group) ?? 0) + 1;
      counts.set(we.superset_group, n);
      superset = `${we.superset_group}${n}`;
    }
    const prev = last.get(we.exercise_id);
    return {
      key: we.id,
      workout_exercise_id: we.id,
      exercise: toLoggerExercise(we.exercise),
      prescription: {
        sets: we.sets,
        reps: we.reps,
        load: we.load,
        rest_seconds: we.rest_seconds,
        tempo: we.tempo,
        notes: we.notes,
        superset_label: superset,
      },
      lastTime: prev ? { performed_on: longDateLabel(prev.performed_on, { month: "short", day: "numeric" }), summary: summarizeSets(prev.sets) } : null,
      sets: buildPrefill({ sets: we.sets, reps: we.reps, load: we.load }, prev?.sets ?? [], defaultUnit),
    };
  });
}
