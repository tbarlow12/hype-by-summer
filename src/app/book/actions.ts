"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { ensureClientLinked } from "@/lib/onboarding";
import { getTrainerBySlug } from "@/lib/trainer";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { SITE_URL } from "@/lib/env";
import { getBookableSessionType, isClientOfTrainer } from "@/lib/scheduling/availability";
import { bookSlot, captureConsultLead, joinWaitlist, markConsultBooked } from "@/lib/scheduling/book";
import { isValidTimeZone } from "@/lib/scheduling/tz";

const slug = z.string().min(1).max(64);
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid time");

const bookSchema = z.object({
  trainer: slug,
  session: slug,
  starts_at: iso,
  timezone: z.string().max(64).optional(),
  name: zfd.text(),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
  phone: z.string().trim().max(32).optional().transform((v) => (v ? v : undefined)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : undefined)),
  payment: z.enum(["stripe", "credits", "pay_later", "free"]),
  sms_opt_in: zfd.checkbox(),
});

async function resolve(trainerSlug: string, sessionSlug: string) {
  const trainer = await getTrainerBySlug(trainerSlug);
  if (!trainer) return null;
  const profile = await getProfile();
  const isClient = profile?.role === "client";
  const linked = Boolean(isClient && profile && (await isClientOfTrainer(profile.id, trainer.trainer_id)));
  const sessionType = await getBookableSessionType(trainer.trainer_id, sessionSlug, { includeClientsOnly: linked });
  if (!sessionType) return null;
  return { trainer, profile: isClient ? profile : null, sessionType };
}

/** Public + client-portal booking (guest or signed-in client). */
export async function createBookingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(bookSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  const target = await resolve(input.trainer, input.session);
  if (!target) return fail("This session type isn't available.");
  const { trainer, profile, sessionType } = target;
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : undefined;

  let clientId: string | null = null;
  let guest: { name: string; email: string; phone?: string } | undefined;
  if (profile) {
    clientId = profile.id;
    await ensureClientLinked(profile, trainer.trainer_id);
  } else {
    if (!input.name) return fail("Please enter your name.");
    if (!input.email) return fail("Please enter your email address.");
    guest = { name: input.name, email: input.email, phone: input.phone };
  }

  let leadId: string | null = null;
  if (!clientId && sessionType.is_consultation && guest) {
    leadId = await captureConsultLead({ trainerId: trainer.trainer_id, email: guest.email, name: guest.name, phone: guest.phone });
  }

  const result = await bookSlot({
    sessionType,
    startsAt: input.starts_at,
    clientId,
    guest,
    phone: input.phone ?? profile?.phone ?? undefined,
    smsOptIn: input.sms_opt_in,
    notes: input.notes,
    clientTimezone: timezone,
    payment: input.payment,
    source: "public",
    leadId,
  });
  if (!result.ok) return { ok: false, error: result.error, data: { code: result.code ?? null } };
  if (leadId) await markConsultBooked(leadId, result.booking);

  const url = result.redirectUrl.startsWith(SITE_URL) ? result.redirectUrl.slice(SITE_URL.length) || "/" : result.redirectUrl;
  redirect(url);
}

const waitlistSchema = z.object({
  trainer: slug,
  session: slug,
  starts_at: iso,
  name: zfd.text(),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional(),
});

export async function joinWaitlistAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(waitlistSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  const target = await resolve(input.trainer, input.session);
  if (!target) return fail("This session type isn't available.");
  const email = target.profile?.email ?? input.email;
  if (!email) return fail("Please enter your email address.");
  const res = await joinWaitlist({
    sessionType: target.sessionType,
    startsAt: input.starts_at,
    email,
    name: target.profile?.full_name ?? input.name,
    clientId: target.profile?.id ?? null,
  });
  if (!res.ok) return fail(res.error ?? "Couldn't join the waitlist.");
  return ok("You're on the waitlist. We'll email you if a spot opens up.");
}
