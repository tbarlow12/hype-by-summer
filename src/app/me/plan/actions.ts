"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { DIFFICULTY_LABELS } from "@/lib/training/adherence";
import { addDays, todayInTz } from "@/lib/training/dates";
import { getLastPerformance, type LastSet } from "@/lib/training/server";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const rating = z.number().int().min(1).max(5).nullable().optional();
const num = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const logSchema = z.object({
  workout_id: z.uuid().nullable(),
  performed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_minutes: z.number().int().min(1).max(600).nullable().optional(),
  session_rpe: num(1, 10),
  difficulty_rating: rating,
  enjoyment_rating: rating,
  energy_level: rating,
  pain_flag: z.boolean(),
  feedback: z.string().trim().max(4000).nullable().optional(),
  sets: z
    .array(
      z.object({
        exercise_id: z.uuid(),
        workout_exercise_id: z.uuid().nullable(),
        set_number: z.number().int().min(1).max(50),
        reps: z.number().int().min(0).max(1000).nullable(),
        weight: num(0, 5000),
        weight_unit: z.enum(["lb", "kg"]),
        duration_seconds: z.number().int().min(0).max(86400).nullable().optional(),
        rpe: num(1, 10),
        completed: z.boolean(),
      }),
    )
    .max(300),
});

export type LogWorkoutInput = z.input<typeof logSchema>;

export async function logWorkout(input: LogWorkoutInput): Promise<Result<{ logId: string }>> {
  const profile = await requireClient();
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid workout" };
  const { sets, ...log } = parsed.data;
  if (log.performed_on > addDays(todayInTz(profile.timezone), 1)) return { ok: false, error: "That date is in the future." };
  if (!log.workout_id && sets.length === 0 && !log.feedback) return { ok: false, error: "Add at least one exercise or a note." };

  const supabase = await createClient();
  let workoutName: string | null = null;
  let programId: string | null = null;
  if (log.workout_id) {
    const { data: w } = await supabase
      .from("program_workouts")
      .select("name, program_id, programs!inner(client_id)")
      .eq("id", log.workout_id)
      .eq("programs.client_id", profile.id)
      .maybeSingle();
    if (!w) return { ok: false, error: "That workout isn't in your program." };
    workoutName = w.name;
    programId = w.program_id;
  }

  const { data: logId, error } = await supabase.rpc("log_workout", { p_log: log, p_sets: sets });
  if (error) return { ok: false, error: error.message };

  const trainerId = await getClientTrainerId(profile.id);
  if (trainerId) {
    const flags = [
      log.pain_flag ? "reported pain" : null,
      log.difficulty_rating ? DIFFICULTY_LABELS[log.difficulty_rating]!.toLowerCase() : null,
      log.session_rpe ? `RPE ${log.session_rpe}` : null,
    ].filter(Boolean);
    await notify({
      userId: trainerId,
      type: log.pain_flag ? "workout_logged_pain" : "workout_logged",
      title: `${displayName(profile)} logged ${workoutName ? `“${workoutName}”` : "a freestyle workout"}${log.pain_flag ? " (pain reported)" : ""}`,
      body: [flags.join(" · "), log.feedback].filter(Boolean).join("\n") || undefined,
      link: programId ? `/coach/programs/${programId}#log-${logId}` : `/coach/clients/${profile.id}`,
      email: log.pain_flag,
    });
  }
  revalidatePath("/me/plan");
  revalidatePath("/me/progress");
  return { ok: true, data: { logId } };
}

/** Prefill source for exercises added on the fly (freestyle logging). */
export async function lastPerformance(exerciseId: string): Promise<{ performed_on: string; sets: LastSet[] } | null> {
  const profile = await requireClient();
  if (!z.uuid().safeParse(exerciseId).success) return null;
  const supabase = await createClient();
  return (await getLastPerformance(supabase, profile.id, [exerciseId])).get(exerciseId) ?? null;
}

const feedbackSchema = z.object({
  program_id: z.uuid(),
  week: zfd.optionalInt(),
  overall_rating: z.coerce.number().int().min(1, "Rate the program").max(5),
  difficulty: z.enum(["too_easy", "just_right", "too_hard"], { message: "How hard is it?" }),
  volume: z.enum(["too_little", "just_right", "too_much"], { message: "How's the amount of work?" }),
  favorite_parts: zfd.text().pipe(z.string().max(2000).optional()),
  least_favorite_parts: zfd.text().pipe(z.string().max(2000).optional()),
  requested_changes: zfd.text().pipe(z.string().max(2000).optional()),
});

export async function submitProgramFeedback(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(feedbackSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("id, name, trainer_id, duration_weeks")
    .eq("id", d.program_id)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!program) return fail("Program not found.");
  const week = d.week && d.week >= 1 && d.week <= program.duration_weeks ? d.week : null;
  const { error } = await supabase.from("program_feedback").insert({
    program_id: program.id,
    client_id: profile.id,
    week,
    overall_rating: d.overall_rating,
    difficulty: d.difficulty,
    volume: d.volume,
    favorite_parts: d.favorite_parts ?? null,
    least_favorite_parts: d.least_favorite_parts ?? null,
    requested_changes: d.requested_changes ?? null,
  });
  if (error) return fail(error.message);
  await notify({
    userId: program.trainer_id,
    type: "program_feedback",
    title: `${displayName(profile)} left feedback on ${program.name}${week ? ` (week ${week})` : ""}`,
    body: [`${d.overall_rating}/5`, d.difficulty.replace("_", " "), `volume ${d.volume.replace("_", " ")}`, d.requested_changes]
      .filter(Boolean)
      .join(" · "),
    link: `/coach/programs/${program.id}#feedback`,
  });
  revalidatePath("/me/plan");
  revalidatePath("/me/plan/feedback");
  return ok("Thanks! Your coach will take a look.");
}
