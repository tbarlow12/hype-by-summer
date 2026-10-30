"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { businessUrl } from "@/lib/tenant";
import { isOwnPublicMediaUrl, isPublicMediaUrlIn } from "@/lib/clients/media";
import { REMINDER_HOUR_OPTIONS, parseList } from "@/lib/clients/settings";
import { FONT_PRESET_VALUES } from "@/lib/clients/branding";

const timezone = z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown timezone");
const RESERVED_SLUGS = new Set(["www", "app", "api", "admin", "auth", "mail", "help", "support", "status", "docs", "blog", "billing", "dashboard", "login", "signup", "static", "assets", "cdn"]);

// ---------------------------------------------------------------------------
// Business profile (managers)
// ---------------------------------------------------------------------------

const businessSchema = z.object({
  name: zfd.requiredText("Business name is required").pipe(z.string().max(120)),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Address: 2-41 lowercase letters, numbers and dashes")
    .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved. Try another."),
  headline: zfd.text().pipe(z.string().max(160).optional()),
  bio: zfd.text().pipe(z.string().max(5000).optional()),
  specialties: zfd.text(),
  certifications: zfd.text(),
  instagram_handle: zfd
    .text()
    .transform((v) => v?.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "") || undefined)
    .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Instagram: just your handle").optional()),
  website_url: zfd.text().pipe(z.url({ protocol: /^https?$/, error: "Website must start with http:// or https://" }).optional()),
  support_email: zfd.text().pipe(z.email("Enter a valid contact email").optional()),
  default_location: zfd.text().pipe(z.string().max(200).optional()),
  timezone,
  cover_image_url: zfd.text(),
});

export async function updateBusinessProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(businessSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.cover_image_url && !isPublicMediaUrlIn(d.cover_image_url, business.id)) return fail("Please upload the cover image again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({
      name: d.name,
      slug: d.slug,
      headline: d.headline ?? null,
      bio: d.bio ?? null,
      specialties: parseList(d.specialties, 20),
      certifications: parseList(d.certifications, 20),
      instagram_handle: d.instagram_handle ?? null,
      website_url: d.website_url ?? null,
      support_email: d.support_email ?? null,
      default_location: d.default_location ?? null,
      timezone: d.timezone,
      cover_image_url: d.cover_image_url ?? null,
    })
    .eq("id", business.id);
  if (error) return fail(error.code === "23505" ? "That address is taken. Try another." : error.message);
  revalidatePath("/", "layout");
  if (d.slug !== business.slug.toLowerCase()) {
    const url = businessUrl({ ...business, slug: d.slug }, "/coach/settings");
    return ok(`Saved. Your platform address is now ${url}. Old links to the previous address stop working; you may need to sign in again there.`, { url });
  }
  return ok("Business profile saved.");
}

// ---------------------------------------------------------------------------
// Branding (managers)
// ---------------------------------------------------------------------------

const brandingSchema = z.object({
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a brand color"),
  font_preset: z.enum(FONT_PRESET_VALUES, { error: "Pick a font style" }),
  logo_url: zfd.text(),
});

export async function updateBranding(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(brandingSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.logo_url && !isPublicMediaUrlIn(d.logo_url, business.id)) return fail("Please upload the logo again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ brand_color: d.brand_color.toLowerCase(), font_preset: d.font_preset, logo_url: d.logo_url ?? null })
    .eq("id", business.id);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return ok("Branding saved. Your site, emails and app icon now use it.");
}

// ---------------------------------------------------------------------------
// Policies (managers)
// ---------------------------------------------------------------------------

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
  const { business } = await requireManager();
  const parsed = parseForm(policiesSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({
      cancellation_window_hours: d.cancellation_window_hours,
      late_cancel_fee_cents: d.late_cancel_fee,
      no_show_fee_cents: d.no_show_fee,
      refund_on_cancel: d.refund_on_cancel,
      accepting_new_clients: d.accepting_new_clients,
      reminder_hours: d["reminder_hours[]"],
    })
    .eq("id", business.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/settings");
  return ok("Policies saved.");
}

// ---------------------------------------------------------------------------
// My profile (every staff member)
// ---------------------------------------------------------------------------

const personalSchema = z.object({
  full_name: zfd.requiredText("Your name is required").pipe(z.string().max(120)),
  phone: zfd.text().pipe(z.string().max(40).optional()),
  timezone,
  avatar_url: zfd.text(),
});

export async function updatePersonal(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireStaff();
  const parsed = parseForm(personalSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.avatar_url && !isOwnPublicMediaUrl(d.avatar_url, profile.id)) return fail("Please upload your photo again.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: d.full_name, phone: d.phone ?? null, timezone: d.timezone, avatar_url: d.avatar_url ?? null })
    .eq("id", profile.id);
  if (error) return fail(error.message);
  revalidatePath("/coach", "layout");
  return ok("Saved.");
}

const coachProfileSchema = z.object({
  title: zfd.text().pipe(z.string().max(80).optional()),
  bio: zfd.text().pipe(z.string().max(3000).optional()),
  specialties: zfd.text(),
  slug: zfd.text().pipe(
    z
      .string()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Profile link: lowercase letters, numbers and dashes")
      .optional(),
  ),
});

/** A staff member's public coach profile within this business (RLS: own row). */
export async function updateCoachProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  const parsed = parseForm(coachProfileSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_members")
    .update({ title: d.title ?? null, bio: d.bio ?? null, specialties: parseList(d.specialties, 12), slug: d.slug ?? null })
    .eq("business_id", business.id)
    .eq("user_id", profile.id)
    .select("user_id");
  if (error) return fail(error.code === "23505" ? "Someone on your team already uses that profile link." : error.message);
  if (!data?.length) return fail("Profile not found");
  revalidatePath("/coach/settings");
  revalidatePath("/coach/team");
  return ok("Coach profile saved.");
}

/** New private ICS token for the signed-in coach: the old feed URL stops working immediately. */
export async function regenerateFeedToken(_: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { profile, business } = await requireStaff();
  // calendar_feed_token isn't readable/writable through the user's API role; scoped to the caller's own row.
  const { error } = await createAdminClient()
    .from("business_members")
    .update({ calendar_feed_token: randomBytes(18).toString("hex") })
    .eq("business_id", business.id)
    .eq("user_id", profile.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/settings");
  return ok("New calendar link created. Re-subscribe with the new URL; the old one no longer works.");
}
