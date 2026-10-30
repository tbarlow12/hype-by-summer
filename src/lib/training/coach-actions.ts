"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { isClientOf } from "./server";

// Staff actions on a client's training. Every row is looked up by id AND the
// current business (a person can be staff at several businesses). The reply
// columns (coach_response / coach_responded_at / responded_by) are stamped by
// the guard_coach_response trigger from auth.uid(), so any staff member can
// reply and the client sees who did.

const uuid = z.uuid();
const responseSchema = z.object({
  response: zfd.requiredText("Write a reply first").pipe(z.string().max(4000, "Keep it under 4000 characters")),
});

function preview(text: string) {
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function coachLabel(name: string | null | undefined) {
  return name?.trim() || "Your coach";
}

function revalidateCoachViews(clientId: string, programId?: string | null) {
  revalidatePath(`/coach/clients/${clientId}`);
  revalidatePath("/coach/check-ins");
  if (programId) revalidatePath(`/coach/programs/${programId}`);
}

export async function respondToWorkoutLog(logId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  if (!uuid.safeParse(logId).success) return fail("Workout log not found.");
  const parsed = parseForm(responseSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: log } = await supabase
    .from("workout_logs")
    .select("id, client_id, coach_response, workout:program_workouts(name, program_id)")
    .eq("id", logId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!log) return fail("Workout log not found.");
  const { error } = await supabase
    .from("workout_logs")
    .update({ coach_response: parsed.data.response })
    .eq("id", logId)
    .eq("business_id", business.id);
  if (error) return fail(error.message);
  await notify({
    userId: log.client_id,
    businessId: business.id,
    type: "workout_log_response",
    title: `${coachLabel(profile.full_name)} replied to ${log.workout?.name ? `“${log.workout.name}”` : "your workout"}`,
    body: preview(parsed.data.response),
    link: `/me/plan#log-${logId}`,
  });
  revalidateCoachViews(log.client_id, log.workout?.program_id);
  return ok(log.coach_response ? "Reply updated." : "Reply sent.");
}

export async function respondToProgramFeedback(feedbackId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  if (!uuid.safeParse(feedbackId).success) return fail("Feedback not found.");
  const parsed = parseForm(responseSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: fb } = await supabase
    .from("program_feedback")
    .select("id, client_id, program_id, coach_response, program:programs!inner(name)")
    .eq("id", feedbackId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!fb) return fail("Feedback not found.");
  const { error } = await supabase
    .from("program_feedback")
    .update({ coach_response: parsed.data.response })
    .eq("id", feedbackId)
    .eq("business_id", business.id);
  if (error) return fail(error.message);
  await notify({
    userId: fb.client_id,
    businessId: business.id,
    type: "program_feedback_response",
    title: `${coachLabel(profile.full_name)} replied to your feedback on ${fb.program.name}`,
    body: preview(parsed.data.response),
    link: "/me/plan/feedback",
  });
  revalidateCoachViews(fb.client_id, fb.program_id);
  return ok(fb.coach_response ? "Reply updated." : "Reply sent.");
}

export async function respondToCheckIn(checkInId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  if (!uuid.safeParse(checkInId).success) return fail("Check-in not found.");
  const parsed = parseForm(responseSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: ci } = await supabase
    .from("check_ins")
    .select("id, client_id, coach_response")
    .eq("id", checkInId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!ci) return fail("Check-in not found.");
  const { error } = await supabase
    .from("check_ins")
    .update({ coach_response: parsed.data.response })
    .eq("id", checkInId)
    .eq("business_id", business.id);
  if (error) return fail(error.message);
  await notify({
    userId: ci.client_id,
    businessId: business.id,
    type: "check_in_response",
    title: `${coachLabel(profile.full_name)} replied to your weekly check-in`,
    body: preview(parsed.data.response),
    link: "/me/check-in",
    email: true,
  });
  revalidateCoachViews(ci.client_id);
  return ok(ci.coach_response ? "Reply updated." : "Reply sent.");
}

// ---------------------------------------------------------------------------
// Habits and goals staff set for a client
// ---------------------------------------------------------------------------
const habitSchema = z.object({
  name: zfd.requiredText("Name the habit").pipe(z.string().max(120)),
  target_per_week: z.coerce.number().int().min(1).max(7),
});

const optionalNumber = z
  .union([z.literal(""), z.coerce.number().finite()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const goalSchema = z.object({
  title: zfd.requiredText("Name the goal").pipe(z.string().max(160)),
  metric: zfd.text().pipe(z.string().max(80).optional()),
  unit: zfd.text().pipe(z.string().max(20).optional()),
  start_value: optionalNumber,
  current_value: optionalNumber,
  target_value: optionalNumber,
  target_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || null),
});

async function staffForClient(clientId: string) {
  const ctx = await requireStaff();
  if (!uuid.safeParse(clientId).success) return null;
  const supabase = await createClient();
  return (await isClientOf(supabase, ctx.business.id, clientId)) ? { ...ctx, supabase } : null;
}

export async function createClientHabit(clientId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await staffForClient(clientId);
  if (!ctx) return fail("Client not found.");
  const parsed = parseForm(habitSchema, formData);
  if (parsed.error) return parsed.error;
  const { error } = await ctx.supabase
    .from("habits")
    .insert({ business_id: ctx.business.id, client_id: clientId, created_by: ctx.profile.id, ...parsed.data });
  if (error) return fail(error.message);
  await notify({
    userId: clientId,
    businessId: ctx.business.id,
    type: "habit_assigned",
    title: `New habit: ${parsed.data.name}`,
    body: `${coachLabel(ctx.profile.full_name)} added a habit for you (${parsed.data.target_per_week}× per week). Tick it off on your Progress page.`,
    link: "/me/progress#habits",
  });
  revalidatePath(`/coach/clients/${clientId}`);
  return ok("Habit added.");
}

export async function setClientHabitActive(habitId: string, active: boolean, _: ActionState): Promise<ActionState> {
  void _;
  const { business } = await requireStaff();
  if (!uuid.safeParse(habitId).success) return fail("Habit not found.");
  const supabase = await createClient();
  const { data: habit } = await supabase
    .from("habits")
    .select("id, client_id")
    .eq("id", habitId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!habit) return fail("Habit not found.");
  const { error } = await supabase.from("habits").update({ active }).eq("id", habitId).eq("business_id", business.id);
  if (error) return fail(error.message);
  revalidatePath(`/coach/clients/${habit.client_id}`);
  return ok(active ? "Habit restored." : "Habit archived.");
}

export async function createClientGoal(clientId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await staffForClient(clientId);
  if (!ctx) return fail("Client not found.");
  const parsed = parseForm(goalSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await ctx.supabase.from("goals").insert({
    business_id: ctx.business.id,
    client_id: clientId,
    created_by: ctx.profile.id,
    title: d.title,
    metric: d.metric ?? null,
    unit: d.unit ?? null,
    start_value: d.start_value ?? d.current_value,
    current_value: d.current_value ?? d.start_value,
    target_value: d.target_value,
    target_date: d.target_date,
  });
  if (error) return fail(error.message);
  await notify({
    userId: clientId,
    businessId: ctx.business.id,
    type: "goal_assigned",
    title: `New goal: ${d.title}`,
    body: `${coachLabel(ctx.profile.full_name)} set a goal with you. Track it on your Progress page.`,
    link: "/me/progress#goals",
  });
  revalidatePath(`/coach/clients/${clientId}`);
  return ok("Goal added.");
}

const goalUpdateSchema = z.object({ current_value: optionalNumber, achieved: zfd.checkbox() });

export async function updateClientGoal(goalId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireStaff();
  if (!uuid.safeParse(goalId).success) return fail("Goal not found.");
  const parsed = parseForm(goalUpdateSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: goal } = await supabase
    .from("goals")
    .select("id, client_id, title, achieved_at")
    .eq("id", goalId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!goal) return fail("Goal not found.");
  const achieved_at = parsed.data.achieved ? (goal.achieved_at ?? new Date().toISOString()) : null;
  const { error } = await supabase
    .from("goals")
    .update({ current_value: parsed.data.current_value, achieved_at })
    .eq("id", goalId)
    .eq("business_id", business.id);
  if (error) return fail(error.message);
  if (achieved_at && !goal.achieved_at) {
    await notify({
      userId: goal.client_id,
      businessId: business.id,
      type: "goal_achieved",
      title: `Goal achieved: ${goal.title}`,
      link: "/me/progress#goals",
    });
  }
  revalidatePath(`/coach/clients/${goal.client_id}`);
  return ok("Goal updated.");
}

export async function deleteClientGoal(goalId: string, _: ActionState): Promise<ActionState> {
  void _;
  const { business } = await requireStaff();
  if (!uuid.safeParse(goalId).success) return fail("Goal not found.");
  const supabase = await createClient();
  const { data: goal } = await supabase
    .from("goals")
    .select("id, client_id")
    .eq("id", goalId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!goal) return fail("Goal not found.");
  const { error } = await supabase.from("goals").delete().eq("id", goalId).eq("business_id", business.id);
  if (error) return fail(error.message);
  revalidatePath(`/coach/clients/${goal.client_id}`);
  return ok("Goal removed.");
}
