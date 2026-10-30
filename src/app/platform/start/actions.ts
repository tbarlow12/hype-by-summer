"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, parseForm, type ActionState } from "@/lib/actions";
import { getBusiness, businessUrl, type Business } from "@/lib/tenant";
import { PLATFORM_DOMAIN, sharedCookieDomain } from "@/lib/platform";
import { planPricing } from "../plans";
import { slugCandidates, slugProblem } from "./slug";

const MAX_BUSINESSES_PER_PERSON = 5;

export type SlugCheck = { slug: string; available: boolean; problem: string | null; suggestions: string[] };

/** Live availability for the signup form. Signed-in only; reveals nothing beyond "taken". */
export async function checkSlug(raw: string): Promise<SlugCheck> {
  const slug = String(raw ?? "").trim().toLowerCase().slice(0, 64);
  if (!(await getProfile())) return { slug, available: false, problem: "Sign in first.", suggestions: [] };
  const problem = slugProblem(slug);
  const candidates = slugCandidates(slug || "coach");
  const { data } = await createAdminClient()
    .from("businesses")
    .select("slug")
    .in("slug", problem ? candidates : [slug, ...candidates]);
  const taken = new Set((data ?? []).map((r) => String(r.slug).toLowerCase()));
  const suggestions = candidates.filter((c) => c !== slug && !taken.has(c)).slice(0, 3);
  if (problem) return { slug, available: false, problem, suggestions };
  const available = !taken.has(slug);
  return { slug, available, problem: available ? null : "That address is taken.", suggestions: available ? [] : suggestions };
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const schema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(80, "Keep the name under 80 characters"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => !slugProblem(s), { message: "Choose a valid web address" }),
  timezone: z.string().trim().refine(isTimeZone, { message: "Choose a timezone" }),
  brand_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a color")
    .transform((c) => c.toLowerCase()),
});

/**
 * Trainer signup: create the business as the signed-in user (create_business
 * RPC makes them the owner), apply their brand color, seed a starter catalog,
 * then send them to their new dashboard.
 */
export async function createBusiness(_: ActionState, formData: FormData): Promise<ActionState> {
  // Only on the platform's own site.
  if (await getBusiness()) return fail("Start a business from the main site.");
  const profile = await getProfile();
  if (!profile) return fail("Please sign in first.");
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const { name, slug, timezone, brand_color } = parsed.data;

  const admin = createAdminClient();
  const { count } = await admin
    .from("business_members")
    .select("business_id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("role", "owner");
  if ((count ?? 0) >= MAX_BUSINESSES_PER_PERSON) {
    return fail("You've reached the limit of businesses per account. Contact us to add more.");
  }

  const supabase = await createClient();
  const { data: business, error } = await supabase.rpc("create_business", { p_slug: slug, p_name: name, p_timezone: timezone });
  if (error || !business) {
    if (error?.code === "23505") return fail(`${slug}.${PLATFORM_DOMAIN} was just taken. Pick another address.`);
    if (error?.code === "23514") return fail("That web address isn't allowed. Pick another.");
    console.error("[start] create_business failed", error);
    return fail("We couldn't create your business. Please try again.");
  }
  const b = business as Business;

  // Brand color as the owner (RLS: managers update their business).
  const { error: colorError } = await supabase.from("businesses").update({ brand_color }).eq("id", b.id);
  if (colorError) console.error("[start] brand color", colorError);

  // Platform fee follows the configured Starter rate (column isn't user-writable).
  const { starterFeeBps } = planPricing();
  if (starterFeeBps !== b.platform_fee_bps) {
    await admin.from("businesses").update({ platform_fee_bps: starterFeeBps }).eq("id", b.id);
  }

  if (!profile.onboarded_at && profile.timezone !== timezone) {
    await supabase.from("profiles").update({ timezone }).eq("id", profile.id);
  }

  await seedStarterCatalog(b.id, profile.id, brand_color);

  // Production: the session cookie covers *.platform-domain, so go straight in.
  // Local dev (<slug>.localhost): cookies aren't shared, so sign in there once.
  if (sharedCookieDomain(PLATFORM_DOMAIN)) redirect(businessUrl(b, "/coach"));
  redirect(businessUrl(b, "/login?next=%2Fcoach&welcome=1"));
}

/** Free consult + a 1:1 session run by the owner, and weekday 9-5 availability. */
async function seedStarterCatalog(businessId: string, ownerId: string, color: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("session_types").insert([
    {
      business_id: businessId,
      coach_ids: [ownerId],
      slug: "free-consult",
      name: "Free consultation",
      description: "20 minutes to talk about your goals, history and whether we're a good fit.",
      duration_minutes: 20,
      price_cents: 0,
      location_type: "virtual",
      requires_payment: false,
      is_consultation: true,
      allow_credits: false,
      credits_required: 0,
      sort_order: 0,
      color,
    },
    {
      business_id: businessId,
      coach_ids: [ownerId],
      slug: "personal-training",
      name: "1:1 Personal training",
      description: "A fully coached session built around your program.",
      duration_minutes: 60,
      price_cents: 7500,
      location_type: "in_person",
      buffer_after_minutes: 15,
      // Paid at the session until the owner connects Stripe and turns on online payment.
      requires_payment: false,
      sort_order: 1,
      color,
    },
  ], { defaultToNull: false });
  if (error) console.error("[start] seed session types", error);
  const { error: hoursError } = await admin.from("availability_rules").insert(
    [1, 2, 3, 4, 5].map((weekday) => ({
      business_id: businessId,
      coach_id: ownerId,
      weekday,
      start_time: "09:00",
      end_time: "17:00",
    })),
  );
  if (hoursError) console.error("[start] seed availability", hoursError);
}
