"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { brandUrl, captureLead, deliverLeadMagnet, notifyLeadOwner, recordLeadEvent } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandOf, requireBusiness } from "@/lib/tenant";
import { consultHref, getPublicSessionTypes } from "@/lib/marketing";
import { consentText, EXPERIENCE_LEVELS, FORMATS, GOALS, TIMELINES, values, type Option } from "@/lib/leads/options";

const optionalEnum = (opts: Option[]) =>
  z
    .union([z.literal(""), z.enum(values(opts))])
    .optional()
    .transform((v) => v || undefined);

const email = z.string().trim().toLowerCase().max(320).pipe(z.email("Enter a valid email"));

const magnetSchema = z.object({
  magnet_id: z.uuid(),
  first_name: zfd.requiredText("Tell us your first name").pipe(z.string().max(100)),
  email,
  phone: zfd.text().pipe(z.string().max(40).optional()),
  primary_goal: optionalEnum(GOALS),
  experience_level: optionalEnum(EXPERIENCE_LEVELS),
  preferred_format: optionalEnum(FORMATS),
  timeline: optionalEnum(TIMELINES),
  marketing_consent: zfd.checkbox(),
  // Honeypot: real people never see this field.
  website: z.string().optional(),
});

/** Lead-magnet opt-in: capture the lead, email the guide, go to the thank-you page. */
export async function submitLeadMagnet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const business = await requireBusiness();
  const parsed = parseForm(magnetSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  // Only this site's own giveaways.
  const { data: magnet } = await createAdminClient()
    .from("lead_magnets")
    .select("id, business_id, slug, title, thank_you_message, active")
    .eq("id", input.magnet_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!magnet?.active) return fail("This guide is no longer available.");
  if (input.website) redirect(`/free/${magnet.slug}/thanks`); // silently drop bots

  const brand = brandOf(business);
  let token: string;
  try {
    const lead = await captureLead({
      businessId: business.id,
      email: input.email,
      firstName: input.first_name,
      phone: input.phone,
      source: "lead_magnet",
      leadMagnetId: magnet.id,
      primaryGoal: input.primary_goal,
      experienceLevel: input.experience_level,
      preferredFormat: input.preferred_format,
      timeline: input.timeline,
      marketingConsent: input.marketing_consent,
      consentText: consentText(business.name),
    });
    const types = await getPublicSessionTypes(business.id);
    const bookUrl = brandUrl(brand, consultHref(business, types));
    ({ token } = await deliverLeadMagnet(brand, lead, magnet, { bookUrl }));
    await notifyLeadOwner(lead, {
      type: "lead_captured",
      title: `New lead: ${input.first_name}`,
      body: `${input.email} downloaded "${magnet.title}".`,
    });
  } catch (err) {
    console.error("[leads] magnet opt-in failed", err);
    return fail("Something went wrong sending your guide. Please try again.");
  }
  redirect(`/free/${magnet.slug}/thanks?t=${encodeURIComponent(token)}`);
}

const contactSchema = z.object({
  name: zfd.requiredText("Tell us your name").pipe(z.string().max(120)),
  email,
  phone: zfd.text().pipe(z.string().max(40).optional()),
  primary_goal: optionalEnum(GOALS),
  preferred_format: optionalEnum(FORMATS),
  timeline: optionalEnum(TIMELINES),
  message: zfd.requiredText("Add a short message").pipe(z.string().max(5000)),
  marketing_consent: zfd.checkbox(),
  website: z.string().optional(),
});

/** Homepage contact form: lead with source contact_form + the message on its timeline. */
export async function submitContactForm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const business = await requireBusiness();
  const parsed = parseForm(contactSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  if (input.website) return ok("Thanks! We'll be in touch shortly.");

  const [firstName, ...rest] = input.name.split(/\s+/);
  try {
    const lead = await captureLead({
      businessId: business.id,
      email: input.email,
      firstName,
      lastName: rest.join(" ") || undefined,
      phone: input.phone,
      source: "contact_form",
      primaryGoal: input.primary_goal,
      goalDetails: input.message,
      preferredFormat: input.preferred_format,
      timeline: input.timeline,
      marketingConsent: input.marketing_consent,
      consentText: consentText(business.name),
    });
    await recordLeadEvent({
      businessId: business.id,
      leadId: lead.id,
      type: "contact_message",
      detail: { message: input.message, phone: input.phone ?? null },
    });
    await notifyLeadOwner(lead, {
      type: "lead_message",
      title: `New inquiry from ${input.name}`,
      body: `${input.email}${input.phone ? ` · ${input.phone}` : ""}\n\n${input.message}`,
      email: true,
    });
  } catch (err) {
    console.error("[leads] contact form failed", err);
    return fail("Your message couldn't be sent. Please try again or email us directly.");
  }
  return ok(`Thanks, ${firstName}! Your message is in. Expect a reply within one business day.`);
}

/** One-click unsubscribe from the link in every marketing email (this business's leads only). */
export async function unsubscribeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const business = await requireBusiness();
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{20,80}$/i.test(token)) return fail("This unsubscribe link is invalid.");
  const { data, error } = await createAdminClient().rpc("unsubscribe_lead", { p_token: token, p_business: business.id });
  if (error || !data?.id) return fail("This unsubscribe link is invalid or has expired.");
  revalidatePath(`/unsubscribe/${token}`);
  return ok(`You're unsubscribed. You won't receive any more marketing emails from ${business.name}.`);
}
