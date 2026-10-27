"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { isSmsConfigured } from "@/lib/sms";
import { AUDIENCES, CHANNELS, audienceCounts, deliverBroadcast, resolveAudience } from "@/lib/comms/broadcast";

export type AudiencePreview = { total: number; inApp: number; email: number; sms: number; smsConfigured: boolean };

async function trainer() {
  const profile = await getProfile();
  return profile && profile.role !== "client" ? profile : null;
}

export async function previewAudience(audience: string): Promise<{ ok: true; preview: AudiencePreview } | { ok: false; error: string }> {
  const profile = await trainer();
  if (!profile) return { ok: false, error: "Not allowed." };
  const parsed = z.enum(AUDIENCES).safeParse(audience);
  if (!parsed.success) return { ok: false, error: "Unknown audience." };
  const recipients = await resolveAudience(profile.id, parsed.data);
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
  const profile = await trainer();
  if (!profile) return { ok: false, error: "Not allowed." };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid broadcast." };
  const v = parsed.data;
  // Leads aren't app users and never get texts: email only.
  const channels = v.audience === "leads" ? v.channels.filter((c) => c === "email") : v.channels;
  if (!channels.length) return { ok: false, error: "Leads can only be reached by email." };

  const recipients = await resolveAudience(profile.id, v.audience);
  if (!recipients.length) return { ok: false, error: "Nobody is in that audience yet." };
  const counts = audienceCounts(recipients);
  const smsBody = (v.smsBody || `${v.subject}: ${v.body}`).slice(0, 300);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("broadcasts")
    .insert({
      trainer_id: profile.id,
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
    trainerId: profile.id,
    trainerName: displayName(profile),
    trainerEmail: profile.email,
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
