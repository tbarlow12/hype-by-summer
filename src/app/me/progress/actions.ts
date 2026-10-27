"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { addDays, todayInTz } from "@/lib/training/dates";

type Result = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const optNum = (min: number, max: number) =>
  z
    .union([z.literal(""), z.coerce.number().min(min).max(max)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

const PATH = "/me/progress";

// ---------------------------------------------------------------------------
// Body metrics
// ---------------------------------------------------------------------------
const metricSchema = z.object({
  measured_on: dateStr,
  unit_system: z.enum(["imperial", "metric"]),
  weight: optNum(20, 1000),
  body_fat_pct: optNum(1, 75),
  waist: optNum(10, 300),
  hips: optNum(10, 300),
  chest: optNum(10, 300),
  arm: optNum(5, 150),
  thigh: optNum(5, 200),
  resting_hr: optNum(25, 220),
  notes: zfd.text().pipe(z.string().max(1000).optional()),
});

export async function addBodyMetric(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(metricSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.measured_on > todayInTz(profile.timezone)) return fail("That date is in the future.");
  const values = [d.weight, d.body_fat_pct, d.waist, d.hips, d.chest, d.arm, d.thigh, d.resting_hr];
  if (values.every((v) => v == null)) return fail("Enter at least one measurement.");
  const supabase = await createClient();
  const { error } = await supabase.from("body_metrics").insert({
    client_id: profile.id,
    ...d,
    resting_hr: d.resting_hr == null ? null : Math.round(d.resting_hr),
    notes: d.notes ?? null,
  });
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Measurements saved.");
}

export async function deleteBodyMetric(id: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireClient();
  if (!uuid.safeParse(id).success) return fail("Not found.");
  const supabase = await createClient();
  const { error } = await supabase.from("body_metrics").delete().eq("id", id).eq("client_id", profile.id);
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Entry removed.");
}

// ---------------------------------------------------------------------------
// Progress photos (the file is uploaded from the browser to progress-photos/<client_id>/...)
// ---------------------------------------------------------------------------
const photoSchema = z.object({
  storage_path: z.string().max(300),
  taken_on: dateStr,
  pose: z.enum(["front", "side", "back", "other"]),
});

export async function recordProgressPhoto(input: z.input<typeof photoSchema>): Promise<Result> {
  const profile = await requireClient();
  const parsed = photoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid photo" };
  const { storage_path, taken_on, pose } = parsed.data;
  if (!new RegExp(`^${profile.id}/[\\w.-]+$`).test(storage_path)) return { ok: false, error: "Invalid upload path." };
  if (taken_on > todayInTz(profile.timezone)) return { ok: false, error: "That date is in the future." };
  const supabase = await createClient();
  const { error } = await supabase.from("progress_photos").insert({ client_id: profile.id, storage_path, taken_on, pose });
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteProgressPhoto(id: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireClient();
  if (!uuid.safeParse(id).success) return fail("Not found.");
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("progress_photos")
    .select("id, storage_path")
    .eq("id", id)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!photo) return fail("Not found.");
  await supabase.storage.from("progress-photos").remove([photo.storage_path]);
  const { error } = await supabase.from("progress_photos").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Photo deleted.");
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------
const habitSchema = z.object({
  name: zfd.requiredText("Name your habit").pipe(z.string().max(120)),
  target_per_week: z.coerce.number().int().min(1).max(7),
});

export async function createHabit(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(habitSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.from("habits").insert({ client_id: profile.id, ...parsed.data });
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Habit added.");
}

export async function toggleHabitDay(habitId: string, date: string, done: boolean): Promise<Result> {
  const profile = await requireClient();
  if (!uuid.safeParse(habitId).success || !dateStr.safeParse(date).success) return { ok: false, error: "Invalid habit." };
  const today = todayInTz(profile.timezone);
  if (date > today || date < addDays(today, -13)) return { ok: false, error: "You can only tick the last two weeks." };
  const supabase = await createClient();
  const { data: habit } = await supabase.from("habits").select("id").eq("id", habitId).eq("client_id", profile.id).maybeSingle();
  if (!habit) return { ok: false, error: "Habit not found." };
  const { error } = done
    ? await supabase.from("habit_logs").upsert({ habit_id: habitId, logged_on: date }, { onConflict: "habit_id,logged_on", ignoreDuplicates: true })
    : await supabase.from("habit_logs").delete().eq("habit_id", habitId).eq("logged_on", date);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function archiveHabit(habitId: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireClient();
  if (!uuid.safeParse(habitId).success) return fail("Habit not found.");
  const supabase = await createClient();
  const { error } = await supabase.from("habits").update({ active: false }).eq("id", habitId).eq("client_id", profile.id);
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Habit archived.");
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
const goalSchema = z.object({
  title: zfd.requiredText("Name your goal").pipe(z.string().max(160)),
  unit: zfd.text().pipe(z.string().max(20).optional()),
  start_value: optNum(-1e6, 1e6),
  target_value: optNum(-1e6, 1e6),
  target_date: z.union([z.literal(""), dateStr]).optional().transform((v) => v || null),
});

export async function createGoal(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(goalSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("goals").insert({
    client_id: profile.id,
    title: d.title,
    unit: d.unit ?? null,
    start_value: d.start_value,
    current_value: d.start_value,
    target_value: d.target_value,
    target_date: d.target_date,
  });
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Goal added.");
}

const goalUpdateSchema = z.object({ current_value: optNum(-1e6, 1e6), achieved: zfd.checkbox() });

export async function updateGoal(goalId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  if (!uuid.safeParse(goalId).success) return fail("Goal not found.");
  const parsed = parseForm(goalUpdateSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: goal } = await supabase
    .from("goals")
    .select("id, title, achieved_at")
    .eq("id", goalId)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!goal) return fail("Goal not found.");
  const achieved_at = parsed.data.achieved ? (goal.achieved_at ?? new Date().toISOString()) : null;
  const { error } = await supabase.from("goals").update({ current_value: parsed.data.current_value, achieved_at }).eq("id", goalId);
  if (error) return fail(error.message);
  if (achieved_at && !goal.achieved_at) {
    const trainerId = await getClientTrainerId(profile.id);
    if (trainerId) {
      await notify({
        userId: trainerId,
        type: "goal_achieved",
        title: `${displayName(profile)} achieved a goal: ${goal.title}`,
        link: `/coach/clients/${profile.id}`,
      });
    }
  }
  revalidatePath(PATH);
  return ok(achieved_at && !goal.achieved_at ? "Goal achieved. Congratulations!" : "Goal updated.");
}

export async function deleteGoal(goalId: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireClient();
  if (!uuid.safeParse(goalId).success) return fail("Goal not found.");
  const supabase = await createClient();
  const { error } = await supabase.from("goals").delete().eq("id", goalId).eq("client_id", profile.id);
  if (error) return fail(error.message);
  revalidatePath(PATH);
  return ok("Goal removed.");
}
