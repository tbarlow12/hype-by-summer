"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, requireClient, type Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { EXPERIENCE_LEVELS, PARQ_QUESTIONS, PRIMARY_GOALS } from "@/lib/clients/intake";
import { isOwnPublicMediaUrl } from "@/lib/clients/media";
import { onboardingSteps, paperworkDone } from "@/lib/clients/onboarding";
import { WAIVER_VERSION } from "@/lib/clients/waiver";
import type { TablesUpdate } from "@/lib/supabase/database.types";

const timezone = z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown timezone");

const profileSchema = z.object({
  full_name: zfd.requiredText("Please enter your name").pipe(z.string().max(120)),
  phone: zfd.text().pipe(z.string().max(40).regex(/^[0-9+().\-\s]*$/, "Digits, spaces and + ( ) - only").optional()),
  timezone,
  date_of_birth: zfd.text().pipe(z.iso.date().optional()),
  avatar_url: zfd.text(),
  marketing_opt_in: zfd.checkbox(),
  sms_opt_in: zfd.checkbox(),
});

export async function updateProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(profileSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.avatar_url && !isOwnPublicMediaUrl(d.avatar_url, profile.id)) return fail("Please upload your photo again.");
  if (d.sms_opt_in && !d.phone) return fail("Add a phone number to receive text reminders.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: d.full_name,
      phone: d.phone ?? null,
      timezone: d.timezone,
      date_of_birth: d.date_of_birth ?? null,
      avatar_url: d.avatar_url ?? null,
      marketing_opt_in: d.marketing_opt_in,
      sms_opt_in: d.sms_opt_in,
    })
    .eq("id", profile.id);
  if (error) return fail(error.message);
  await markOnboardedIfDone(profile.id);
  revalidatePath("/me", "layout");
  return ok("Profile saved.");
}

const yesNo = z.enum(["yes", "no"], { error: "Please answer every question" });
const intakeSchema = z.object({
  ...Object.fromEntries(PARQ_QUESTIONS.map((q) => [`parq_${q.key}`, yesNo])),
  injuries: zfd.text().pipe(z.string().max(2000).optional()),
  medications: zfd.text().pipe(z.string().max(2000).optional()),
  experience_level: z.enum(EXPERIENCE_LEVELS.map((e) => e.value) as [string, ...string[]], { error: "Choose your experience level" }),
  primary_goal: z.enum(PRIMARY_GOALS.map((g) => g.value) as [string, ...string[]], { error: "Choose a primary goal" }),
  emergency_contact_name: zfd.requiredText("Emergency contact name is required").pipe(z.string().max(120)),
  emergency_contact_phone: zfd.requiredText("Emergency contact phone is required").pipe(z.string().max(40)),
});

export async function saveIntake(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(intakeSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data as Record<string, string | undefined>;
  const answers = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.key, d[`parq_${q.key}`] === "yes"]));

  const res = await writeIntake(profile, {
    answers,
    injuries: d.injuries ?? null,
    medications: d.medications ?? null,
    experience_level: d.experience_level!,
    primary_goal: d.primary_goal!,
    emergency_contact_name: d.emergency_contact_name!,
    emergency_contact_phone: d.emergency_contact_phone!,
  });
  if (res) return res;
  await markOnboardedIfDone(profile.id);
  revalidatePath("/me", "layout");
  const flagged = Object.values(answers).some(Boolean);
  return ok(
    flagged
      ? "Intake saved. Because you answered yes to at least one question, please check with your doctor before starting and let your coach know."
      : "Intake saved. Thank you!",
  );
}

const waiverSchema = z.object({
  signature: zfd.requiredText("Type your full name to sign").pipe(z.string().min(2, "Type your full name to sign").max(120)),
  agree: zfd.checkbox().refine((v) => v, "Please tick the box to confirm you agree"),
  version: z.literal(WAIVER_VERSION, { error: "The waiver was updated; please reload the page and review it again." }),
});

export async function signWaiver(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(waiverSchema, formData);
  if (parsed.error) return parsed.error;
  // waiver_accepted_at is stamped by a database trigger.
  const res = await writeIntake(profile, { waiver_signature: parsed.data.signature, waiver_version: WAIVER_VERSION });
  if (res) return res;
  await markOnboardedIfDone(profile.id);
  revalidatePath("/me", "layout");
  return ok("Waiver signed. Thank you!");
}

async function writeIntake(profile: Profile, patch: TablesUpdate<"client_intakes">): Promise<ActionState | null> {
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) return fail("You're not connected to a coach yet. Please contact us.");
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("client_intakes")
    .select("id")
    .eq("client_id", profile.id)
    .eq("trainer_id", trainerId)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("client_intakes").update(patch).eq("id", existing.id)
    : await supabase.from("client_intakes").insert({ ...patch, client_id: profile.id, trainer_id: trainerId });
  return error ? fail(error.message) : null;
}

async function markOnboardedIfDone(clientId: string) {
  const supabase = await createClient();
  const trainerId = await getClientTrainerId(clientId);
  const [{ data: p }, { data: intake }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, onboarded_at").eq("id", clientId).single(),
    trainerId
      ? supabase.from("client_intakes").select("*").eq("client_id", clientId).eq("trainer_id", trainerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!p || p.onboarded_at) return;
  if (paperworkDone(onboardingSteps({ profile: p, intake, hasBooking: false }))) {
    await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", clientId);
  }
}
