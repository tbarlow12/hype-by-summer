"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import {
  EXERCISE_FIELDS,
  isTrainerOf,
  loadWorkout,
  loadWorkouts,
  trySystemMessage,
  type ExerciseLite,
  type WorkoutExerciseRow,
  type WorkoutRow,
} from "@/lib/training/server";
import { longDateLabel } from "@/lib/training/dates";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const okR = <T,>(data: T): Result<T> => ({ ok: true, data });
const failR = (error: string): Result<never> => ({ ok: false, error });

const uuid = z.uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

async function ownedProgram(programId: string) {
  const profile = await requireTrainer();
  if (!uuid.safeParse(programId).success) return null;
  const supabase = await createClient();
  const { data: program } = await supabase
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("trainer_id", profile.id)
    .maybeSingle();
  return program ? { profile, supabase, program } : null;
}

async function ownedWorkout(workoutId: string) {
  const profile = await requireTrainer();
  if (!uuid.safeParse(workoutId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("program_workouts")
    .select("id, program_id, week, day, programs!inner(trainer_id, duration_weeks)")
    .eq("id", workoutId)
    .eq("programs.trainer_id", profile.id)
    .maybeSingle();
  return data ? { profile, supabase, workout: data } : null;
}

// ---------------------------------------------------------------------------
// Program metadata, lifecycle and assignment
// ---------------------------------------------------------------------------
const metaSchema = z.object({
  name: zfd.requiredText("Name is required").pipe(z.string().max(120)),
  description: zfd.text().pipe(z.string().max(4000).optional()),
  goal: zfd.text().pipe(z.string().max(200).optional()),
  duration_weeks: z.coerce.number().int().min(1, "At least 1 week").max(52, "52 weeks max"),
});

const createSchema = metaSchema.extend({
  client_id: z.union([z.literal(""), uuid]).optional(),
  start_date: z.union([z.literal(""), dateStr]).optional(),
});

export async function createProgram(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(createSchema, formData);
  if (parsed.error) return parsed.error;
  const { client_id, start_date, ...meta } = parsed.data;
  const supabase = await createClient();
  if (client_id) {
    if (!start_date) return fail("Pick a start date for the client's program.");
    if (!(await isTrainerOf(supabase, profile.id, client_id))) return fail("That client isn't on your roster.");
  }
  const { data, error } = await supabase
    .from("programs")
    .insert({
      ...meta,
      description: meta.description ?? null,
      goal: meta.goal ?? null,
      trainer_id: profile.id,
      client_id: client_id || null,
      start_date: client_id ? start_date : null,
      status: client_id ? "active" : "draft",
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (client_id) await announceProgram(profile.id, client_id, meta.name, start_date!);
  revalidatePath("/coach/programs");
  redirect(`/coach/programs/${data.id}`);
}

async function announceProgram(trainerId: string, clientId: string, name: string, start: string) {
  await notify({
    userId: clientId,
    type: "program_assigned",
    title: `New program: ${name}`,
    body: `Your coach set up “${name}” for you, starting ${longDateLabel(start)}.`,
    link: "/me/plan",
    email: true,
  });
  await trySystemMessage({
    trainerId,
    clientId,
    body: `New program assigned: ${name} (starts ${longDateLabel(start)}). Find it under My plan.`,
  });
}

const updateMetaSchema = metaSchema.extend({ start_date: z.union([z.literal(""), dateStr]).optional() });

export async function updateProgramMeta(programId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const owned = await ownedProgram(programId);
  if (!owned) return fail("Program not found.");
  const parsed = parseForm(updateMetaSchema, formData);
  if (parsed.error) return parsed.error;
  const { supabase, program } = owned;
  const { start_date, ...meta } = parsed.data;
  if (meta.duration_weeks < program.duration_weeks) {
    const { error } = await supabase
      .from("program_workouts")
      .delete()
      .eq("program_id", programId)
      .gt("week", meta.duration_weeks);
    if (error) return fail(error.message);
  }
  const { error } = await supabase
    .from("programs")
    .update({
      ...meta,
      description: meta.description ?? null,
      goal: meta.goal ?? null,
      ...(program.client_id && start_date ? { start_date } : {}),
    })
    .eq("id", programId);
  if (error) return fail(error.message);
  revalidatePath(`/coach/programs/${programId}`);
  return ok("Program details saved.");
}

const STATUS_FOR = {
  template: ["draft", "active", "archived"],
  client: ["active", "completed", "archived"],
} as const;

export async function setProgramStatus(programId: string, status: string, _: ActionState): Promise<ActionState> {
  void _;
  const owned = await ownedProgram(programId);
  if (!owned) return fail("Program not found.");
  const { supabase, program, profile } = owned;
  const allowed: readonly string[] = program.client_id ? STATUS_FOR.client : STATUS_FOR.template;
  if (!allowed.includes(status)) return fail("Invalid status.");
  const { error } = await supabase
    .from("programs")
    .update({ status: status as "draft" | "active" | "completed" | "archived" })
    .eq("id", programId);
  if (error) return fail(error.message);
  if (program.client_id && status === "completed") {
    await notify({
      userId: program.client_id,
      type: "program_completed",
      title: `You finished ${program.name}!`,
      body: "Nice work. Tell your coach how it went so the next block is even better.",
      link: "/me/plan/feedback",
    });
    await trySystemMessage({ trainerId: profile.id, clientId: program.client_id, body: `Program completed: ${program.name}.` });
  }
  revalidatePath(`/coach/programs/${programId}`);
  revalidatePath("/coach/programs");
  return ok(`Program marked ${status}.`);
}

const assignSchema = z.object({
  client_id: uuid,
  start_date: dateStr,
  archive_others: zfd.checkbox(),
});

export async function assignProgram(templateId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const owned = await ownedProgram(templateId);
  if (!owned) return fail("Program not found.");
  const { supabase, program, profile } = owned;
  if (program.client_id) return fail("Only templates can be assigned. Save this program as a template first.");
  const parsed = parseForm(assignSchema, formData);
  if (parsed.error) return parsed.error;
  const { client_id, start_date, archive_others } = parsed.data;
  if (!(await isTrainerOf(supabase, profile.id, client_id))) return fail("That client isn't on your roster.");

  if (archive_others) {
    await supabase
      .from("programs")
      .update({ status: "completed" })
      .eq("trainer_id", profile.id)
      .eq("client_id", client_id)
      .eq("status", "active");
  }
  const { data: newId, error } = await supabase.rpc("assign_program", {
    p_template: templateId,
    p_client: client_id,
    p_start: start_date,
  });
  if (error) return fail(error.message === "not_your_client" ? "That client isn't on your roster." : error.message);
  if (program.status === "draft") await supabase.from("programs").update({ status: "active" }).eq("id", templateId);
  await announceProgram(profile.id, client_id, program.name, start_date);
  revalidatePath("/coach/programs");
  redirect(`/coach/programs/${newId}?assigned=1`);
}

export async function duplicateProgram(programId: string, _: ActionState): Promise<ActionState> {
  void _;
  const owned = await ownedProgram(programId);
  if (!owned) return fail("Program not found.");
  const name = owned.program.client_id ? `${owned.program.name} (template)` : `${owned.program.name} (copy)`;
  const { data, error } = await owned.supabase.rpc("duplicate_program", { p_program: programId, p_name: name });
  if (error) return fail(error.message);
  revalidatePath("/coach/programs");
  redirect(`/coach/programs/${data}`);
}

export async function deleteProgram(programId: string, _: ActionState): Promise<ActionState> {
  void _;
  const owned = await ownedProgram(programId);
  if (!owned) return fail("Program not found.");
  if (owned.program.client_id) return fail("Client programs keep their history. Archive it instead.");
  const { error } = await owned.supabase.from("programs").delete().eq("id", programId);
  if (error) return fail(error.message);
  revalidatePath("/coach/programs");
  redirect("/coach/programs");
}

// ---------------------------------------------------------------------------
// Builder operations (called from the client builder; return data, not forms)
// ---------------------------------------------------------------------------
const weekDay = z.object({ week: z.number().int().min(1).max(104), day: z.number().int().min(1).max(7) });

export async function addWorkout(programId: string, week: number, day: number, name: string): Promise<Result<WorkoutRow>> {
  const owned = await ownedProgram(programId);
  if (!owned) return failR("Program not found.");
  const wd = weekDay.safeParse({ week, day });
  if (!wd.success || week > owned.program.duration_weeks) return failR("Invalid week or day.");
  const cleanName = name.trim().slice(0, 120) || "Workout";
  const { supabase } = owned;
  const { data: siblings } = await supabase
    .from("program_workouts")
    .select("sort_order")
    .eq("program_id", programId)
    .eq("week", week)
    .eq("day", day);
  const sort = Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1;
  const { data, error } = await supabase
    .from("program_workouts")
    .insert({ program_id: programId, week, day, name: cleanName, sort_order: sort })
    .select("*")
    .single();
  if (error) return failR(error.message);
  return okR({ ...data, exercises: [] });
}

const workoutPatch = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    notes: z.string().max(4000).nullable(),
    estimated_minutes: z.number().int().min(1).max(600).nullable(),
    week: z.number().int().min(1).max(104),
    day: z.number().int().min(1).max(7),
    sort_order: z.number().int().min(0).max(1000),
  })
  .partial();

export async function updateWorkout(workoutId: string, patch: z.input<typeof workoutPatch>): Promise<Result> {
  const owned = await ownedWorkout(workoutId);
  if (!owned) return failR("Workout not found.");
  const parsed = workoutPatch.safeParse(patch);
  if (!parsed.success) return failR(parsed.error.issues[0]?.message ?? "Invalid input");
  if (parsed.data.week && parsed.data.week > owned.workout.programs.duration_weeks) return failR("That week is past the end of the program.");
  const data = { ...parsed.data, ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes?.trim() || null } : {}) };
  const { error } = await owned.supabase.from("program_workouts").update(data).eq("id", workoutId);
  return error ? failR(error.message) : okR(undefined);
}

export async function deleteWorkout(workoutId: string): Promise<Result> {
  const owned = await ownedWorkout(workoutId);
  if (!owned) return failR("Workout not found.");
  const { error } = await owned.supabase.from("program_workouts").delete().eq("id", workoutId);
  return error ? failR(error.message) : okR(undefined);
}

export async function reorderWorkouts(programId: string, orderedIds: string[]): Promise<Result> {
  const owned = await ownedProgram(programId);
  if (!owned) return failR("Program not found.");
  const ids = z.array(uuid).max(50).safeParse(orderedIds);
  if (!ids.success) return failR("Invalid order.");
  const results = await Promise.all(
    ids.data.map((id, i) =>
      owned.supabase.from("program_workouts").update({ sort_order: i }).eq("id", id).eq("program_id", programId),
    ),
  );
  const err = results.find((r) => r.error)?.error;
  return err ? failR(err.message) : okR(undefined);
}

export async function duplicateWorkout(workoutId: string, week: number, day: number): Promise<Result<WorkoutRow>> {
  const owned = await ownedWorkout(workoutId);
  if (!owned) return failR("Workout not found.");
  if (!weekDay.safeParse({ week, day }).success || week > owned.workout.programs.duration_weeks) return failR("Invalid week or day.");
  const { data: newId, error } = await owned.supabase.rpc("duplicate_program_workout", {
    p_workout: workoutId,
    p_week: week,
    p_day: day,
  });
  if (error) return failR(error.message);
  const row = await loadWorkout(owned.supabase, newId);
  return row ? okR(row) : failR("Copied, but couldn't load it. Refresh the page.");
}

export async function copyWeek(
  programId: string,
  fromWeek: number,
  toWeeks: number[],
  replace: boolean,
): Promise<Result<WorkoutRow[]>> {
  const owned = await ownedProgram(programId);
  if (!owned) return failR("Program not found.");
  const max = owned.program.duration_weeks;
  const targets = [...new Set(toWeeks)].filter((w) => Number.isInteger(w) && w >= 1 && w <= max && w !== fromWeek);
  if (!targets.length) return failR("Pick at least one other week.");
  const { error } = await owned.supabase.rpc("copy_program_week", {
    p_program: programId,
    p_from_week: fromWeek,
    p_to_weeks: targets,
    p_replace: !!replace,
  });
  if (error) return failR(error.message);
  return okR(await loadWorkouts(owned.supabase, programId));
}

export async function addExerciseToWorkout(workoutId: string, exerciseId: string): Promise<Result<WorkoutExerciseRow>> {
  const owned = await ownedWorkout(workoutId);
  if (!owned || !uuid.safeParse(exerciseId).success) return failR("Workout not found.");
  const { supabase, profile } = owned;
  const { data: exercise } = await supabase.from("exercises").select(EXERCISE_FIELDS).eq("id", exerciseId).maybeSingle();
  if (!exercise || (exercise.trainer_id && exercise.trainer_id !== profile.id)) return failR("Exercise not found.");
  const { data: siblings } = await supabase.from("workout_exercises").select("sort_order").eq("workout_id", workoutId);
  const sort = Math.max(-1, ...(siblings ?? []).map((s) => s.sort_order)) + 1;
  const defaults =
    exercise.category === "cardio"
      ? { sets: 1, reps: "20 min", rest_seconds: null }
      : exercise.category === "mobility"
        ? { sets: 2, reps: "30s", rest_seconds: 30 }
        : { sets: 3, reps: "8-10", rest_seconds: 90 };
  const { data, error } = await supabase
    .from("workout_exercises")
    .insert({ workout_id: workoutId, exercise_id: exerciseId, sort_order: sort, ...defaults })
    .select("*")
    .single();
  if (error) return failR(error.message);
  return okR({ ...data, exercise: exercise as ExerciseLite });
}

const exercisePatch = z
  .object({
    sets: z.number().int().min(1, "At least 1 set").max(20, "20 sets max"),
    reps: z.string().trim().max(40).nullable(),
    load: z.string().trim().max(60).nullable(),
    rest_seconds: z.number().int().min(0).max(3600).nullable(),
    tempo: z.string().trim().max(20).nullable(),
    notes: z.string().trim().max(1000).nullable(),
    superset_group: z.string().trim().max(4).nullable(),
  })
  .partial();

export async function updateWorkoutExercise(id: string, patch: z.input<typeof exercisePatch>): Promise<Result> {
  await requireTrainer();
  if (!uuid.safeParse(id).success) return failR("Not found.");
  const parsed = exercisePatch.safeParse(patch);
  if (!parsed.success) return failR(parsed.error.issues[0]?.message ?? "Invalid input");
  const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  const d = parsed.data;
  const clean = {
    sets: d.sets,
    reps: blank(d.reps),
    load: blank(d.load),
    rest_seconds: d.rest_seconds,
    tempo: blank(d.tempo),
    notes: blank(d.notes),
    superset_group: blank(d.superset_group)?.toUpperCase() ?? (d.superset_group === undefined ? undefined : null),
  };
  const supabase = await createClient();
  // RLS limits updates to exercises inside the trainer's own programs.
  const { data, error } = await supabase.from("workout_exercises").update(clean).eq("id", id).select("id");
  if (error) return failR(error.message);
  return data?.length ? okR(undefined) : failR("Not found.");
}

export async function removeWorkoutExercise(id: string): Promise<Result> {
  await requireTrainer();
  if (!uuid.safeParse(id).success) return failR("Not found.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("workout_exercises").delete().eq("id", id).select("id");
  if (error) return failR(error.message);
  return data?.length ? okR(undefined) : failR("Not found.");
}

export async function reorderWorkoutExercises(workoutId: string, orderedIds: string[]): Promise<Result> {
  const owned = await ownedWorkout(workoutId);
  if (!owned) return failR("Workout not found.");
  const ids = z.array(uuid).max(60).safeParse(orderedIds);
  if (!ids.success) return failR("Invalid order.");
  const results = await Promise.all(
    ids.data.map((id, i) =>
      owned.supabase.from("workout_exercises").update({ sort_order: i }).eq("id", id).eq("workout_id", workoutId),
    ),
  );
  const err = results.find((r) => r.error)?.error;
  return err ? failR(err.message) : okR(undefined);
}
