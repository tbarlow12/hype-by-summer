import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { notify } from "@/lib/notify";
import { computePersonalRecords, type LoggedSet, type PersonalRecord } from "./records";
import { responsibleCoachIds } from "./routing";

// Every query here is scoped to one business explicitly. RLS also applies, but
// a person can be staff (or a client) at more than one business, so RLS alone
// would mix businesses together.

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export const EXERCISE_FIELDS =
  "id, business_id, name, category, primary_muscles, equipment, instructions, coaching_cues, demo_video_url, thumbnail_url, is_unilateral" as const;

export type ExerciseLite = Pick<
  Tables<"exercises">,
  | "id"
  | "business_id"
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

/** PostgREST `or` filter for the exercises a business can use (global + its own). */
export function exerciseLibraryFilter(businessId: string): string {
  return `business_id.is.null,business_id.eq.${businessId}`;
}

export type WorkoutExerciseRow = Tables<"workout_exercises"> & { exercise: ExerciseLite };
export type WorkoutRow = Tables<"program_workouts"> & { exercises: WorkoutExerciseRow[] };
export type ProgramTree = { program: Tables<"programs">; workouts: WorkoutRow[] };

/** Name of whoever wrote a coach reply (embedded via responded_by). */
export type Responder = { responder?: { full_name: string | null } | null };

const sortWorkouts = (a: WorkoutRow, b: WorkoutRow) => a.week - b.week || a.day - b.day || a.sort_order - b.sort_order;

/** Workouts with their exercises (RLS decides visibility; the program was scoped by the caller). */
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

/** A program of this business with its workouts, or null. */
export async function loadProgramTree(supabase: Supabase, businessId: string, programId: string): Promise<ProgramTree | null> {
  const { data: program } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("business_id", businessId)
    .maybeSingle();
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

/** The client's current program at this business: newest active one. */
export async function getActiveProgram(supabase: Supabase, businessId: string, clientId: string) {
  const { data } = await supabase
    .from("programs")
    .select("*")
    .eq("business_id", businessId)
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
 * The client's most recent logged sets for each exercise at this business
 * (from their latest session that included it), plus that session's date.
 */
export async function getLastPerformance(
  supabase: Supabase,
  businessId: string,
  clientId: string,
  exerciseIds: string[],
): Promise<Map<string, { performed_on: string; sets: LastSet[] }>> {
  const out = new Map<string, { performed_on: string; sets: LastSet[] }>();
  if (exerciseIds.length === 0) return out;
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("id, performed_on, created_at")
    .eq("business_id", businessId)
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
        .map((s) => ({ ...s, weight: s.weight == null ? null : Number(s.weight), rpe: s.rpe == null ? null : Number(s.rpe) }))
        .sort((a, b) => a.set_number - b.set_number),
    });
  }
  return out;
}

/** PRs from every completed weighted set the client has logged at this business. */
export async function getPersonalRecords(supabase: Supabase, businessId: string, clientId: string): Promise<PersonalRecord[]> {
  const { data } = await supabase
    .from("set_logs")
    .select("exercise_id, reps, weight, weight_unit, completed, exercise:exercises(name), log:workout_logs!inner(business_id, client_id, performed_on)")
    .eq("log.business_id", businessId)
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

/** True when the person is a client of the business (any relationship status). */
export async function isClientOf(supabase: Supabase, businessId: string, clientId: string): Promise<boolean> {
  const { data } = await supabase
    .from("business_clients")
    .select("client_id")
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .maybeSingle();
  return !!data;
}

export type RosterEntry = { client_id: string; primary_coach_id: string | null; client: { full_name: string | null; email: string } | null };

/** The business's current clients (for pickers). */
export async function loadRoster(supabase: Supabase, businessId: string): Promise<RosterEntry[]> {
  const { data } = await supabase
    .from("business_clients")
    .select("client_id, primary_coach_id, client:profiles!business_clients_client_id_fkey(full_name, email)")
    .eq("business_id", businessId)
    .in("status", ["active", "invited", "paused"]);
  return data ?? [];
}

export type StaffEntry = { user_id: string; role: Tables<"business_members">["role"]; full_name: string | null; email: string };

/** Active staff of the business with names (for "responsible coach" pickers and labels). */
export async function loadStaff(businessId: string): Promise<StaffEntry[]> {
  const { data } = await createAdminClient()
    .from("business_members")
    .select("user_id, role, profile:profiles!business_members_user_id_fkey(full_name, email)")
    .eq("business_id", businessId)
    .eq("active", true);
  return (data ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    full_name: m.profile?.full_name ?? null,
    email: m.profile?.email ?? "",
  }));
}

/** System line in the business/client chat thread; never fails the calling action. */
export async function trySystemMessage(input: { businessId: string; clientId: string; body: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: conversationId, error } = await admin.rpc("ensure_conversation", {
      p_business: input.businessId,
      p_client: input.clientId,
    });
    if (error || !conversationId) throw error ?? new Error("no conversation");
    const { error: insertError } = await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: null,
      kind: "system",
      body: input.body.slice(0, 4000),
    });
    if (insertError) throw insertError;
  } catch (err) {
    console.error("[training] system message failed", err);
  }
}

/**
 * Notify whoever is responsible for this client's training at the business:
 * the program's coach, else the client's primary coach, else owners/admins.
 * Ids are resolved server-side from the business; best-effort.
 */
export async function notifyResponsibleCoach(input: {
  businessId: string;
  clientId: string;
  programCoachId?: string | null;
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: members }, { data: rel }] = await Promise.all([
      admin.from("business_members").select("user_id, role, active").eq("business_id", input.businessId),
      admin
        .from("business_clients")
        .select("primary_coach_id")
        .eq("business_id", input.businessId)
        .eq("client_id", input.clientId)
        .maybeSingle(),
    ]);
    const ids = responsibleCoachIds({
      programCoachId: input.programCoachId,
      primaryCoachId: rel?.primary_coach_id,
      members: members ?? [],
    });
    await Promise.all(
      ids.map((userId) =>
        notify({
          userId,
          businessId: input.businessId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          email: input.email,
        }),
      ),
    );
  } catch (err) {
    console.error("[training] notifyResponsibleCoach failed", err);
  }
}

export type LogWithSets = Tables<"workout_logs"> &
  Responder & {
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

/** Workout logs at this business (newest first) with their sets and the program workout they belong to. */
export async function loadLogs(
  supabase: Supabase,
  opts: { businessId: string; clientId: string; programId?: string; limit?: number },
): Promise<LogWithSets[]> {
  let query = supabase
    .from("workout_logs")
    .select(
      "*, responder:profiles!workout_logs_responded_by_fkey(full_name), set_logs(exercise_id, set_number, reps, weight, weight_unit, duration_seconds, rpe, completed, exercise:exercises(name)), workout:program_workouts" +
        (opts.programId ? "!inner" : "") +
        "(name, week, day, program_id)",
    )
    .eq("business_id", opts.businessId)
    .eq("client_id", opts.clientId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.programId) query = query.eq("workout.program_id", opts.programId);
  const { data } = await query;
  type Raw = Tables<"workout_logs"> &
    Responder & {
      set_logs: (Omit<LogWithSets["sets"][number], "exercise_name"> & { exercise: { name: string } | null })[];
      workout: LogWithSets["workout"];
    };
  return ((data ?? []) as unknown as Raw[]).map(({ set_logs, ...log }) => ({
    ...log,
    sets: (set_logs ?? [])
      .map(({ exercise, ...s }) => ({
        ...s,
        weight: s.weight == null ? null : Number(s.weight),
        rpe: s.rpe == null ? null : Number(s.rpe),
        exercise_name: exercise?.name ?? "Exercise",
      }))
      .sort((a, b) => a.set_number - b.set_number),
  }));
}

/** Preferred weight unit: from the client's latest body metrics entry at this business. */
export async function preferredUnit(supabase: Supabase, businessId: string, clientId: string): Promise<"lb" | "kg"> {
  const { data } = await supabase
    .from("body_metrics")
    .select("unit_system")
    .eq("business_id", businessId)
    .eq("client_id", clientId)
    .order("measured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.unit_system === "metric" ? "kg" : "lb";
}
