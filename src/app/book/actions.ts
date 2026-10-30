"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ensureClientLinked } from "@/lib/onboarding";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { coachesForType, getBookableSessionType } from "@/lib/scheduling/availability";
import { bookSlot, captureConsultLead, joinWaitlist, markConsultBooked } from "@/lib/scheduling/book";
import { publicBookingContext } from "@/lib/scheduling/public";
import { isValidTimeZone } from "@/lib/scheduling/tz";

const slug = z.string().min(1).max(64);
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid time");
const coach = z.union([z.literal("any"), z.uuid()]).default("any");

const bookSchema = z.object({
  session: slug,
  coach,
  starts_at: iso,
  timezone: z.string().max(64).optional(),
  name: zfd.text(),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
  phone: z.string().trim().max(32).optional().transform((v) => (v ? v : undefined)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : undefined)),
  payment: z.enum(["stripe", "credits", "pay_later", "free"]),
  sms_opt_in: zfd.checkbox(),
});

/** Business from the host; session type looked up within it (never from the form). */
async function resolve(sessionSlug: string) {
  const ctx = await publicBookingContext();
  const sessionType = await getBookableSessionType(ctx.business.id, sessionSlug, { includeClientsOnly: ctx.isClient });
  if (!sessionType) return null;
  return { ...ctx, sessionType };
}

/** Public + client-portal booking (guest or signed-in person) on the current business's site. */
export async function createBookingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(bookSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  const target = await resolve(input.session);
  if (!target) return fail("This session type isn't available.");
  const { business, viewer, relationship, sessionType, coaches } = target;
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : undefined;

  let clientId: string | null = null;
  let guest: { name: string; email: string; phone?: string } | undefined;
  if (viewer) {
    clientId = viewer.id;
    await ensureClientLinked(viewer, business.id);
  } else {
    if (!input.name) return fail("Please enter your name.");
    if (!input.email) return fail("Please enter your email address.");
    guest = { name: input.name, email: input.email, phone: input.phone };
  }

  let lead: { id: string; isNew: boolean } | null = null;
  if (!clientId && sessionType.is_consultation && guest) {
    lead = await captureConsultLead({
      businessId: business.id,
      // Only a coach who actually runs this session (bookSlot re-checks before booking).
      coachId: input.coach !== "any" && coachesForType(sessionType, coaches).some((c) => c.id === input.coach) ? input.coach : null,
      email: guest.email, name: guest.name, phone: guest.phone });
  }

  const result = await bookSlot({
    business,
    sessionType,
    coachId: input.coach === "any" ? null : input.coach,
    preferredCoachId: relationship?.primary_coach_id ?? null,
    startsAt: input.starts_at,
    clientId,
    guest,
    phone: input.phone ?? viewer?.phone ?? undefined,
    smsOptIn: input.sms_opt_in,
    notes: input.notes,
    clientTimezone: timezone,
    payment: input.payment,
    source: "public",
    leadId: lead?.id ?? null,
    coaches,
  });
  if (!result.ok) return { ok: false, error: result.error, data: { code: result.code ?? null } };
  if (lead) await markConsultBooked(lead.id, result.booking, { newLead: lead.isNew });
  redirect(result.redirectUrl);
}

const waitlistSchema = z.object({
  session: slug,
  coach,
  starts_at: iso,
  name: zfd.text(),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
});

export async function joinWaitlistAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(waitlistSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  const target = await resolve(input.session);
  if (!target) return fail("This session type isn't available.");
  const email = target.viewer?.email ?? input.email;
  if (!email) return fail("Please enter your email address.");
  const res = await joinWaitlist({
    sessionType: target.sessionType,
    coachId: input.coach === "any" ? null : input.coach,
    startsAt: input.starts_at,
    email,
    name: target.viewer?.full_name ?? input.name,
    clientId: target.viewer?.id ?? null,
  });
  if (!res.ok) return fail(res.error ?? "Couldn't join the waitlist.");
  return ok("You're on the waitlist. We'll email you if a spot opens up.");
}
