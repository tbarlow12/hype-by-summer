"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { isOwnPublicMediaUrl } from "@/lib/clients/media";
import { REMINDER_HOUR_OPTIONS, parseList } from "@/lib/clients/settings";

const timezone = z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown timezone");

const storefrontSchema = z.object({
  business_name: zfd.requiredText("Business name is required").pipe(z.string().max(120)),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Booking link: 2-41 lowercase letters, numbers and dashes"),
  headline: zfd.text().pipe(z.string().max(160).optional()),
  bio: zfd.text().pipe(z.string().max(5000).optional()),
  specialties: zfd.text(),
  certifications: zfd.text(),
  instagram_handle: zfd.text().transform((v) =>
    v?.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "") || undefined,
  ).pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Instagram: just your handle").optional()),
  website_url: zfd.text().pipe(z.url({ protocol: /^https?$/, error: "Website must start with http:// or https://" }).optional()),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a brand colour"),
  cover_image_url: zfd.text(),
});

export async function updateStorefront(_: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(storefrontSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.cover_image_url && !isOwnPublicMediaUrl(d.cover_image_url, trainer.id)) return fail("Please upload the cover image again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("trainer_profiles")
    .update({
      business_name: d.business_name,
      slug: d.slug,
      headline: d.headline ?? null,
      bio: d.bio ?? null,
      specialties: parseList(d.specialties, 20),
      certifications: parseList(d.certifications, 20),
      instagram_handle: d.instagram_handle ?? null,
      website_url: d.website_url ?? null,
      brand_color: d.brand_color.toLowerCase(),
      cover_image_url: d.cover_image_url ?? null,
    })
    .eq("trainer_id", trainer.id);
  if (error) return fail(error.code === "23505" ? "That booking link is taken. Try another." : error.message);
  revalidatePath("/", "layout");
  return ok("Storefront saved.");
}

const policiesSchema = z.object({
  cancellation_window_hours: z.coerce.number().int().min(0).max(720),
  late_cancel_fee: zfd.cents().pipe(z.number().max(100_000)),
  no_show_fee: zfd.cents().pipe(z.number().max(100_000)),
  refund_on_cancel: zfd.checkbox(),
  accepting_new_clients: zfd.checkbox(),
  "reminder_hours[]": z
    .array(z.coerce.number().int())
    .optional()
    .transform((v) => [...new Set((v ?? []).filter((h) => (REMINDER_HOUR_OPTIONS as readonly number[]).includes(h)))].sort((a, b) => b - a)),
});

export async function updatePolicies(_: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(policiesSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("trainer_profiles")
    .update({
      cancellation_window_hours: d.cancellation_window_hours,
      late_cancel_fee_cents: d.late_cancel_fee,
      no_show_fee_cents: d.no_show_fee,
      refund_on_cancel: d.refund_on_cancel,
      accepting_new_clients: d.accepting_new_clients,
      reminder_hours: d["reminder_hours[]"],
    })
    .eq("trainer_id", trainer.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/settings");
  return ok("Policies saved.");
}

const personalSchema = z.object({
  full_name: zfd.requiredText("Your name is required").pipe(z.string().max(120)),
  phone: zfd.text().pipe(z.string().max(40).optional()),
  timezone,
  avatar_url: zfd.text(),
});

export async function updatePersonal(_: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(personalSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.avatar_url && !isOwnPublicMediaUrl(d.avatar_url, trainer.id)) return fail("Please upload your photo again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: d.full_name, phone: d.phone ?? null, timezone: d.timezone, avatar_url: d.avatar_url ?? null })
    .eq("id", trainer.id);
  if (error) return fail(error.message);
  revalidatePath("/coach", "layout");
  return ok("Saved.");
}

/** New private ICS token: the old subscription URL stops working immediately. */
export async function regenerateFeedToken(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const trainer = await requireTrainer();
  const admin = createAdminClient();
  const { error } = await admin
    .from("trainer_profiles")
    .update({ calendar_feed_token: randomBytes(18).toString("hex") })
    .eq("trainer_id", trainer.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/settings");
  return ok("New calendar link created. Re-subscribe with the new URL; the old one no longer works.");
}
