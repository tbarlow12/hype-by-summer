"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { addDays, isValidTimeZone, timeToMinutes, zonedTimeToUtc } from "@/lib/scheduling/tz";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Invalid time");
const rulesSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      start: time,
      end: time,
      types: z.array(z.uuid()).max(50).default([]),
    }),
  )
  .max(100);

export async function saveWeeklyHoursAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("rules") ?? "[]"));
  } catch {
    return fail("Invalid hours.");
  }
  const parsed = rulesSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid hours.");
  const rules = parsed.data;
  for (const r of rules) {
    if (timeToMinutes(r.end) <= timeToMinutes(r.start)) return fail("Each range must end after it starts.");
  }
  const supabase = await createClient();
  if (rules.some((r) => r.types.length)) {
    const ids = [...new Set(rules.flatMap((r) => r.types))];
    const { count } = await supabase.from("session_types").select("id", { count: "exact", head: true }).eq("trainer_id", profile.id).in("id", ids);
    if (count !== ids.length) return fail("Unknown session type.");
  }
  const { error: delError } = await supabase.from("availability_rules").delete().eq("trainer_id", profile.id);
  if (delError) return fail(delError.message);
  if (rules.length) {
    const { error } = await supabase.from("availability_rules").insert(
      rules.map((r) => ({
        trainer_id: profile.id,
        weekday: r.weekday,
        start_time: r.start,
        end_time: r.end === "24:00" ? "24:00:00" : r.end,
        session_type_ids: r.types.length ? r.types : null,
      })),
    );
    if (error) return fail(error.message);
  }
  revalidatePath("/coach/availability");
  return ok("Weekly hours saved.");
}

const overrideSchema = z.object({
  kind: z.enum(["off", "extra"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  end_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  all_day: zfd.checkbox(),
  start_time: z.union([z.literal(""), time]).optional(),
  end_time: z.union([z.literal(""), time]).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function addOverrideAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(overrideSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const tz = profile.timezone;
  const endDate = v.end_date || v.start_date;
  let startsAt: Date;
  let endsAt: Date;
  if (v.all_day) {
    startsAt = zonedTimeToUtc(v.start_date, 0, tz);
    endsAt = zonedTimeToUtc(addDays(endDate, 1), 0, tz);
  } else {
    if (!v.start_time || !v.end_time) return fail("Enter a start and end time, or choose all day.");
    startsAt = zonedTimeToUtc(v.start_date, timeToMinutes(v.start_time), tz);
    endsAt = zonedTimeToUtc(endDate, timeToMinutes(v.end_time), tz);
  }
  if (endsAt <= startsAt) return fail("The end must be after the start.");
  if (v.kind === "extra" && endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) return fail("Extra hours can span at most 31 days.");
  const supabase = await createClient();
  const { error } = await supabase.from("availability_overrides").insert({
    trainer_id: profile.id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    is_available: v.kind === "extra",
    reason: v.reason || null,
  });
  if (error) return fail(error.message);
  revalidatePath("/coach/availability");
  return ok(v.kind === "off" ? "Time off added." : "Extra hours added.");
}

export async function deleteOverrideAction(formData: FormData): Promise<void> {
  const profile = await requireTrainer();
  const id = z.uuid().parse(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("availability_overrides").delete().eq("id", id).eq("trainer_id", profile.id);
  revalidatePath("/coach/availability");
}

export async function saveTimezoneAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const tz = String(formData.get("timezone") ?? "");
  if (!tz || !isValidTimeZone(tz)) return fail("Unknown timezone.");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ timezone: tz }).eq("id", profile.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/availability");
  revalidatePath("/coach/calendar");
  return ok("Timezone saved. Your weekly hours now follow this timezone.");
}
