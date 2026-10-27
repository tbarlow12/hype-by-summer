"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { todayInTz, weekStartMonday } from "@/lib/training/dates";

const rating = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(5)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const schema = z.object({
  body_weight: z
    .union([z.literal(""), z.coerce.number().min(40, "Check your weight").max(1000, "Check your weight")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  sleep_quality: rating,
  stress_level: rating,
  energy_level: rating,
  nutrition_adherence: rating,
  training_adherence: rating,
  wins: zfd.text().pipe(z.string().max(2000).optional()),
  struggles: zfd.text().pipe(z.string().max(2000).optional()),
  questions: zfd.text().pipe(z.string().max(2000).optional()),
});

export async function submitCheckIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) return fail("You're not connected to a coach yet.");
  const today = todayInTz(profile.timezone);
  const week_of = weekStartMonday(today);
  const d = parsed.data;
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("check_ins")
    .select("id")
    .eq("client_id", profile.id)
    .eq("trainer_id", trainerId)
    .eq("week_of", week_of)
    .maybeSingle();

  const row = {
    client_id: profile.id,
    trainer_id: trainerId,
    week_of,
    body_weight: d.body_weight,
    sleep_quality: d.sleep_quality,
    stress_level: d.stress_level,
    energy_level: d.energy_level,
    nutrition_adherence: d.nutrition_adherence,
    training_adherence: d.training_adherence,
    wins: d.wins ?? null,
    struggles: d.struggles ?? null,
    questions: d.questions ?? null,
  };
  const { error } = existing
    ? await supabase.from("check_ins").update(row).eq("id", existing.id)
    : await supabase.from("check_ins").insert(row);
  if (error) return fail(error.message);

  // Keep the progress chart in sync: record the check-in weight for today if nothing is logged yet.
  if (d.body_weight != null) {
    const { data: metric } = await supabase
      .from("body_metrics")
      .select("id, weight")
      .eq("client_id", profile.id)
      .eq("measured_on", today)
      .limit(1)
      .maybeSingle();
    if (!metric) await supabase.from("body_metrics").insert({ client_id: profile.id, measured_on: today, weight: d.body_weight });
    else if (metric.weight == null) await supabase.from("body_metrics").update({ weight: d.body_weight }).eq("id", metric.id);
  }

  await notify({
    userId: trainerId,
    type: "check_in",
    title: existing ? `${displayName(profile)} updated their weekly check-in` : `${displayName(profile)} checked in`,
    body: [d.questions ? `Question: ${d.questions}` : null, d.struggles ? `Struggles: ${d.struggles}` : null].filter(Boolean).join("\n") || undefined,
    link: "/coach/check-ins",
  });
  revalidatePath("/me/check-in");
  revalidatePath("/me/progress");
  return ok(existing ? "Check-in updated." : "Check-in sent. Your coach will reply soon.");
}
