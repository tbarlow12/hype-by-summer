"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMembership, getProfile, isManager } from "@/lib/auth";
import { brandOf, getBusiness } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { isSmsConfigured } from "@/lib/sms";
import { AUDIENCES, CHANNELS, audienceCounts, deliverBroadcast, resolveAudience } from "@/lib/comms/broadcast";

export type AudiencePreview = { total: number; inApp: number; email: number; sms: number; smsConfigured: boolean };

/** Broadcasts are for owners/admins of the current business only. */
async function manager() {
  const [profile, business, membership] = await Promise.all([getProfile(), getBusiness(), getMembership()]);
  if (!profile || !business || !isManager(membership)) return null;
  return { profile, business };
}

export async function previewAudience(audience: string): Promise<{ ok: true; preview: AudiencePreview } | { ok: false; error: string }> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "Not allowed." };
  const parsed = z.enum(AUDIENCES).safeParse(audience);
  if (!parsed.success) return { ok: false, error: "Unknown audience." };
  const recipients = await resolveAudience(ctx.business.id, parsed.data);
  return { ok: true, preview: { ...audienceCounts(recipients), smsConfigured: isSmsConfigured() } };
}

const sendSchema = z.object({
  audience: z.enum(AUDIENCES),
  subject: z.string().trim().min(1, "Add a subject.").max(150),
  body: z.string().trim().min(1, "Write your message.").max(10000),
  smsBody: z.string().trim().max(300, "SMS text must be 300 characters or fewer.").optional(),
  channels: z.array(z.enum(CHANNELS)).min(1, "Pick at least one channel."),
});

export async function sendBroadcast(
  input: z.input<typeof sendSchema>,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "Not allowed." };
  const { profile, business } = ctx;
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid broadcast." };
  const v = parsed.data;
  // Leads aren't app users and never get texts: email only.
  const channels = v.audience === "leads" ? v.channels.filter((c) => c === "email") : v.channels;
  if (!channels.length) return { ok: false, error: "Leads can only be reached by email." };

  const recipients = await resolveAudience(business.id, v.audience);
  if (!recipients.length) return { ok: false, error: "Nobody is in that audience yet." };
  const counts = audienceCounts(recipients);
  const smsBody = (v.smsBody || `${v.subject}: ${v.body}`).slice(0, 300);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("broadcasts")
    .insert({
      business_id: business.id,
      sent_by: profile.id,
      audience: v.audience,
      subject: v.subject,
      body: v.body,
      channels,
      sms_body: channels.includes("sms") ? smsBody : null,
      recipient_count: counts.total,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "Couldn't save the broadcast." };

  const result = await deliverBroadcast({
    broadcastId: row.id,
    brand: { ...brandOf(business), businessId: business.id },
    senderName: displayName(profile),
    replyTo: business.support_email ?? profile.email,
    subject: v.subject,
    body: v.body,
    smsBody,
    channels,
    recipients,
  });
  revalidatePath("/coach/broadcasts");
  const parts = [
    channels.includes("in_app") ? `${result.inApp} in-app` : null,
    channels.includes("email") ? `${result.emailsSent} email${result.emailsSent === 1 ? "" : "s"}${result.emailsFailed ? ` (${result.emailsFailed} failed)` : ""}` : null,
    channels.includes("sms") ? `${result.sms} text${result.sms === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return { ok: true, message: `Sent: ${parts.join(", ")}.` };
}
