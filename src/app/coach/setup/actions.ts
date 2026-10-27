"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, parseForm, zfd, type ActionState } from "@/lib/actions";

const schema = z.object({
  business_name: zfd.requiredText(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Lowercase letters, numbers and dashes"),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown timezone"),
  headline: zfd.text(),
  bio: zfd.text(),
});

export async function setupStorefront(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const { timezone, ...storefront } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("trainer_profiles").insert({ trainer_id: profile.id, ...storefront });
  if (error) return fail(error.code === "23505" ? "That booking link is taken." : error.message);
  await supabase.from("profiles").update({ timezone, onboarded_at: new Date().toISOString() }).eq("id", profile.id);

  // Starter catalogue so the booking page works immediately.
  const admin = createAdminClient();
  await admin.from("session_types").insert([
    { trainer_id: profile.id, slug: "free-consult", name: "Free consultation", description: "A 20-minute call to talk goals and see if we're a fit.", duration_minutes: 20, price_cents: 0, location_type: "virtual", requires_payment: false, is_consultation: true, allow_credits: false, credits_required: 0, sort_order: 0 },
    { trainer_id: profile.id, slug: "personal-training", name: "1:1 Personal training", description: "A full coached session tailored to you.", duration_minutes: 60, price_cents: 9000, location_type: "in_person", buffer_after_minutes: 15, sort_order: 1 },
    { trainer_id: profile.id, slug: "virtual-session", name: "Virtual training session", description: "Live coaching over video, anywhere.", duration_minutes: 45, price_cents: 6500, location_type: "virtual", sort_order: 2 },
  ]);
  const weekdays = [1, 2, 3, 4, 5];
  await admin.from("availability_rules").insert(
    weekdays.flatMap((weekday) => [
      { trainer_id: profile.id, weekday, start_time: "06:00", end_time: "11:00" },
      { trainer_id: profile.id, weekday, start_time: "16:00", end_time: "19:00" },
    ]),
  );
  redirect("/coach");
}
