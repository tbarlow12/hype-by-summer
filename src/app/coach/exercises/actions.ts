"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { EXERCISE_CATEGORIES } from "@/lib/training/constants";
import { parseVideoUrl } from "@/lib/training/video";
import { EXERCISE_FIELDS } from "@/lib/training/server";

const tag = z.string().trim().toLowerCase().max(40).transform((v) => v.replace(/\s+/g, "_"));

const csv = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean));

const schema = z.object({
  name: zfd.requiredText("Name is required").pipe(z.string().max(120)),
  category: z.union([z.enum(EXERCISE_CATEGORIES), z.literal("")]).optional().transform((v) => v || null),
  "primary_muscles[]": z.array(tag).optional().default([]),
  muscles_other: csv,
  "equipment[]": z.array(tag).optional().default([]),
  equipment_other: csv,
  instructions: zfd.text().pipe(z.string().max(4000).optional()),
  coaching_cues: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20)),
  demo_video_url: zfd
    .text()
    .refine((v) => !v || parseVideoUrl(v) !== null, "Use a YouTube, Vimeo or direct .mp4 link"),
  is_unilateral: zfd.checkbox(),
});

function toRow(d: z.infer<typeof schema>) {
  const uniq = (a: string[]) => [...new Set(a)].slice(0, 20);
  return {
    name: d.name,
    category: d.category,
    primary_muscles: uniq([...d["primary_muscles[]"], ...d.muscles_other]),
    equipment: uniq([...d["equipment[]"], ...d.equipment_other]),
    instructions: d.instructions ?? null,
    coaching_cues: d.coaching_cues,
    demo_video_url: d.demo_video_url ?? null,
    is_unilateral: d.is_unilateral,
  };
}

export async function createExercise(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .insert({ ...toRow(parsed.data), trainer_id: profile.id })
    .select("id")
    .single();
  if (error) return fail(error.message);
  revalidatePath("/coach/exercises");
  redirect(`/coach/exercises/${data.id}?saved=1`);
}

export async function updateExercise(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .update(toRow(parsed.data))
    .eq("id", id)
    .eq("trainer_id", profile.id)
    .select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("You can only edit your own exercises.");
  revalidatePath("/coach/exercises");
  revalidatePath(`/coach/exercises/${id}`);
  return ok("Exercise saved.");
}

export async function deleteExercise(id: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireTrainer();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("exercises")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("trainer_id", profile.id);
  if (error) {
    return fail(error.code === "23503" ? "This exercise is used in programs or logs. Remove it from those first." : error.message);
  }
  if (!count) return fail("You can only delete your own exercises.");
  revalidatePath("/coach/exercises");
  redirect("/coach/exercises");
}

/** Copy a global (or own) exercise into the trainer's library to customize. */
export async function duplicateExercise(id: string, _: ActionState): Promise<ActionState> {
  void _;
  const profile = await requireTrainer();
  const supabase = await createClient();
  const { data: src } = await supabase.from("exercises").select(EXERCISE_FIELDS).eq("id", id).maybeSingle();
  if (!src || (src.trainer_id && src.trainer_id !== profile.id)) return fail("Exercise not found.");
  const { id: _id, trainer_id: _t, ...rest } = src;
  void _id;
  void _t;
  const { data, error } = await supabase
    .from("exercises")
    .insert({ ...rest, name: src.trainer_id ? `${src.name} (copy)` : src.name, trainer_id: profile.id })
    .select("id")
    .single();
  if (error) return fail(error.message);
  revalidatePath("/coach/exercises");
  redirect(`/coach/exercises/${data.id}?copied=1`);
}
