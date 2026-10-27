import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { sendSystemMessage } from "@/lib/messaging";
import { computePersonalRecords, type LoggedSet, type PersonalRecord } from "./records";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export const EXERCISE_FIELDS =
  "id, trainer_id, name, category, primary_muscles, equipment, instructions, coaching_cues, demo_video_url, thumbnail_url, is_unilateral" as const;

export type ExerciseLite = Pick<
  Tables<"exercises">,
  | "id"
  | "trainer_id"
  | "name"
  | "category"
  | "primary_muscles"
  | "equipment"
  | "instructions"
  | "coaching_cues"
  | "demo_video_url"
  | "thumbnail_url"
  | "is_unilateral"
>;

export type WorkoutExerciseRow = Tables<"workout_exercises"> & { exercise: ExerciseLite };
export type WorkoutRow = Tables<"program_workouts"> & { exercises: WorkoutExerciseRow[] };
export type ProgramTree = { program: Tables<"programs">; workouts: WorkoutRow[] };

const sortWorkouts = (a: WorkoutRow, b: WorkoutRow) => a.week - b.week || a.day - b.day || a.sort_order - b.sort_order;

/** Workouts with their exercises (RLS decides visibility). */
export async function loadWorkouts(supabase: Supabase, programId: string): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from("program_workouts")
    .select(`*, workout_exercises(*, exercise:exercises(${EXERCISE_FIELDS}))`)
    .eq("program_id", programId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map(({ workout_exercises, ...w }) => ({
      ...w,
      exercises: (workout_exercises ?? [])
        .filter((we) => we.exercise)
        .map((we) => ({ ...we, exercise: we.exercise as ExerciseLite }))
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .sort(sortWorkouts);
}

export async function loadProgramTree(supabase: Supabase, programId: string): Promise<ProgramTree | null> {
  const { data: program } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
  if (!program) return null;
  return { program, workouts: await loadWorkouts(supabase, programId) };
}

/** A single workout with exercises, or null if not visible. */
export async function loadWorkout(supabase: Supabase, workoutId: string): Promise<WorkoutRow | null> {
  const { data } = await supabase
    .from("program_workouts")
    .select(`*, workout_exercises(*, exercise:exercises(${EXERCISE_FIELDS}))`)
    .eq("id", workoutId)
    .maybeSingle();
  if (!data) return null;
  const { workout_exercises, ...w } = data;
  return {
    ...w,
    exercises: (workout_exercises ?? [])
      .filter((we) => we.exercise)
      .map((we) => ({ ...we, exercise: we.exercise as ExerciseLite }))
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

/** The client's current program: newest active one. */
export async function getActiveProgram(supabase: Supabase, clientId: string) {
  const { data } = await supabase
    .from("programs")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export type LastSet = {
  set_number: number;
  reps: number | null;
  weight: number | null;
  weight_unit: string;
  duration_seconds: number | null;
  rpe: number | null;
};

/**
 * The client's most recent logged sets for each exercise (from their latest
 * session that included it), plus that session's date.
 */
export async function getLastPerformance(
  supabase: Supabase,
  clientId: string,
  exerciseIds: string[],
): Promise<Map<string, { performed_on: string; sets: LastSet[] }>> {
  const out = new Map<string, { performed_on: string; sets: LastSet[] }>();
  if (exerciseIds.length === 0) return out;
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("id, performed_on, created_at")
    .eq("client_id", clientId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (!logs?.length) return out;
  const { data: sets } = await supabase
    .from("set_logs")
    .select("workout_log_id, exercise_id, set_number, reps, weight, weight_unit, duration_seconds, rpe")
    .in("workout_log_id", logs.map((l) => l.id))
    .in("exercise_id", exerciseIds);
  const rank = new Map(logs.map((l, i) => [l.id, i]));
  const bestLog = new Map<string, string>();
  for (const s of sets ?? []) {
    const cur = bestLog.get(s.exercise_id);
    if (!cur || rank.get(s.workout_log_id)! < rank.get(cur)!) bestLog.set(s.exercise_id, s.workout_log_id);
  }
  for (const [exerciseId, logId] of bestLog) {
    const log = logs.find((l) => l.id === logId)!;
    out.set(exerciseId, {
      performed_on: log.performed_on,
      sets: (sets ?? [])
        .filter((s) => s.workout_log_id === logId && s.exercise_id === exerciseId)
        .sort((a, b) => a.set_number - b.set_number),
    });
  }
  return out;
}

/** PRs from every completed weighted set the client has logged. */
export async function getPersonalRecords(supabase: Supabase, clientId: string): Promise<PersonalRecord[]> {
  const { data } = await supabase
    .from("set_logs")
    .select("exercise_id, reps, weight, weight_unit, completed, exercise:exercises(name), log:workout_logs!inner(client_id, performed_on)")
    .eq("log.client_id", clientId)
    .eq("completed", true)
    .not("weight", "is", null)
    .not("reps", "is", null)
    .limit(5000);
  const sets: LoggedSet[] = (data ?? []).map((s) => ({
    exercise_id: s.exercise_id,
    exercise_name: s.exercise?.name ?? "Exercise",
    reps: s.reps,
    weight: s.weight == null ? null : Number(s.weight),
    weight_unit: s.weight_unit,
    completed: s.completed,
    performed_on: s.log?.performed_on ?? "",
  }));
  return computePersonalRecords(sets);
}

/** True when the trainer coaches this client (any non-deleted relationship). */
export async function isTrainerOf(supabase: Supabase, trainerId: string, clientId: string): Promise<boolean> {
  const { data } = await supabase
    .from("trainer_clients")
    .select("client_id")
    .eq("trainer_id", trainerId)
    .eq("client_id", clientId)
    .maybeSingle();
  return !!data;
}

/** Drop a line in the trainer/client chat; never fails the calling action. */
export async function trySystemMessage(input: { trainerId: string; clientId: string; body: string }) {
  try {
    await sendSystemMessage(input);
  } catch (err) {
    console.error("[training] sendSystemMessage failed", err);
  }
}

export type LogWithSets = Tables<"workout_logs"> & {
  sets: {
    exercise_id: string;
    set_number: number;
    reps: number | null;
    weight: number | null;
    weight_unit: string;
    duration_seconds: number | null;
    rpe: number | null;
    completed: boolean;
    exercise_name: string;
  }[];
  workout: { name: string; week: number; day: number; program_id: string } | null;
};

/** Workout logs (newest first) with their sets and the program workout they belong to. */
export async function loadLogs(
  supabase: Supabase,
  opts: { clientId: string; programId?: string; limit?: number },
): Promise<LogWithSets[]> {
  let query = supabase
    .from("workout_logs")
    .select(
      "*, set_logs(exercise_id, set_number, reps, weight, weight_unit, duration_seconds, rpe, completed, exercise:exercises(name)), workout:program_workouts" +
        (opts.programId ? "!inner" : "") +
        "(name, week, day, program_id)",
    )
    .eq("client_id", opts.clientId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.programId) query = query.eq("workout.program_id", opts.programId);
  const { data } = await query;
  type Raw = Tables<"workout_logs"> & {
    set_logs: (Omit<LogWithSets["sets"][number], "exercise_name"> & { exercise: { name: string } | null })[];
    workout: LogWithSets["workout"];
  };
  return ((data ?? []) as unknown as Raw[]).map(({ set_logs, ...log }) => ({
    ...log,
    sets: (set_logs ?? [])
      .map(({ exercise, ...s }) => ({ ...s, weight: s.weight == null ? null : Number(s.weight), exercise_name: exercise?.name ?? "Exercise" }))
      .sort((a, b) => a.set_number - b.set_number),
  }));
}

/** Preferred weight unit: from the client's latest body metrics entry. */
export async function preferredUnit(supabase: Supabase, clientId: string): Promise<"lb" | "kg"> {
  const { data } = await supabase
    .from("body_metrics")
    .select("unit_system")
    .eq("client_id", clientId)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.unit_system === "metric" ? "kg" : "lb";
}
