"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { getCoach, type Coach } from "@/lib/scheduling/availability";
import { canEditAvailability } from "@/lib/scheduling/staff";
import { addDays, isValidTimeZone, timeToMinutes, zonedTimeToUtc } from "@/lib/scheduling/tz";

// Coaches edit their own availability; managers edit anyone's and the
// business-wide closures (coach_id null). RLS enforces the same rule.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Invalid time");
/** A coach's id, or "business" for business-wide closures. */
const target = z.union([z.literal("business"), z.uuid()]);

type Target = { staff: StaffContext; coach: Coach | null };

async function authorize(raw: unknown): Promise<Target | { error: ActionState }> {
  const staff = await requireStaff();
  const parsed = target.safeParse(raw ?? staff.profile.id);
  if (!parsed.success) return { error: fail("Unknown coach.") };
  const coachId = parsed.data === "business" ? null : parsed.data;
  if (!canEditAvailability(staff.membership, coachId)) return { error: fail("You can only edit your own availability.") };
  if (coachId === null) return { staff, coach: null };
  const coach = await getCoach(staff.business.id, coachId);
  if (!coach) return { error: fail("That person isn't on your team.") };
  return { staff, coach };
}

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
  const auth = await authorize(formData.get("coach_id"));
  if ("error" in auth) return auth.error;
  const { staff, coach } = auth;
  if (!coach) return fail("Pick a coach.");
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
    const { count } = await supabase
      .from("session_types")
      .select("id", { count: "exact", head: true })
      .eq("business_id", staff.business.id)
      .in("id", ids);
    if (count !== ids.length) return fail("Unknown session type.");
  }
  const { error: delError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("business_id", staff.business.id)
    .eq("coach_id", coach.id);
  if (delError) return fail(delError.message);
  if (rules.length) {
    const { error } = await supabase.from("availability_rules").insert(
      rules.map((r) => ({
        business_id: staff.business.id,
        coach_id: coach.id,
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
  coach_id: target.optional(),
  kind: z.enum(["off", "extra"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  end_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  all_day: zfd.checkbox(),
  start_time: z.union([z.literal(""), time]).optional(),
  end_time: z.union([z.literal(""), time]).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function addOverrideAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(overrideSchema, formData);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const auth = await authorize(v.coach_id);
  if ("error" in auth) return auth.error;
  const { staff, coach } = auth;
  if (!coach && v.kind === "extra") return fail("Business closures block time; add extra hours per coach.");
  const tz = coach?.timezone ?? staff.business.timezone;
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
    business_id: staff.business.id,
    coach_id: coach?.id ?? null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    is_available: v.kind === "extra",
    reason: v.reason || null,
  });
  if (error) return fail(error.message);
  revalidatePath("/coach/availability");
  return ok(!coach ? "Closure added." : v.kind === "off" ? "Time off added." : "Extra hours added.");
}

export async function deleteOverrideAction(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = z.uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("availability_overrides")
    .select("id, coach_id")
    .eq("id", id)
    .eq("business_id", staff.business.id)
    .maybeSingle();
  if (!row || !canEditAvailability(staff.membership, row.coach_id)) return;
  await supabase.from("availability_overrides").delete().eq("id", row.id).eq("business_id", staff.business.id);
  revalidatePath("/coach/availability");
}

export async function saveTimezoneAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(formData.get("coach_id"));
  if ("error" in auth) return auth.error;
  const { staff, coach } = auth;
  if (!coach) return fail("Pick a coach.");
  const tz = String(formData.get("timezone") ?? "");
  if (!tz || !isValidTimeZone(tz)) return fail("Unknown timezone.");
  // Own profile through RLS; a manager setting a team member's zone (authorized above) uses the service role.
  const { error } =
    coach.id === staff.profile.id
      ? await (await createClient()).from("profiles").update({ timezone: tz }).eq("id", coach.id)
      : await createAdminClient().from("profiles").update({ timezone: tz }).eq("id", coach.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/availability");
  revalidatePath("/coach/calendar");
  return ok("Timezone saved. Weekly hours now follow this timezone.");
}
