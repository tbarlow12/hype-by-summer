"use server";

import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createVideoRoom } from "@/lib/video";
import { notify } from "@/lib/notify";
import { createSignedUpload, notifyRecipientOfMessage, sendSystemMessage, type SignedUpload } from "@/lib/messaging";
import { CHAT_BUCKET, VIDEO_BUCKET, isOwnPath, kindForMime } from "@/lib/comms/policy";
import { formatDate, displayName } from "@/lib/format";
import { MESSAGE_COLUMNS, type ChatMessage } from "@/lib/comms/types";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const uploadSchema = z.object({
  bucket: z.enum([CHAT_BUCKET, VIDEO_BUCKET]),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(255),
  size: z.number().int().positive(),
});

/** Step 1 of a browser upload: get a signed URL for `<my id>/<uuid>.<ext>`. */
export async function requestUpload(input: z.infer<typeof uploadSchema>): Promise<Result<{ upload: SignedUpload }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid file." };
  return createSignedUpload({ uploaderId: profile.id, ...parsed.data, contentType: parsed.data.contentType || "application/octet-stream" });
}

const sendSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    body: z.string().trim().max(4000).optional(),
    attachmentPath: z.string().max(300).optional(),
    attachmentMime: z.string().max(255).optional(),
  })
  .refine((v) => Boolean(v.body) || Boolean(v.attachmentPath), "Write a message or attach a file.");

export async function sendChatMessage(input: z.infer<typeof sendSchema>): Promise<Result<{ message: ChatMessage }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message." };
  const v = parsed.data;
  if (v.attachmentPath && !isOwnPath(profile.id, v.attachmentPath)) return { ok: false, error: "Invalid attachment." };

  const supabase = await createClient();
  // RLS: sender must be me and a member of the conversation.
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id: v.id,
      conversation_id: v.conversationId,
      sender_id: profile.id,
      kind: v.attachmentPath ? kindForMime(v.attachmentMime) : "text",
      body: v.body || null,
      attachment_path: v.attachmentPath ?? null,
      attachment_mime: v.attachmentPath ? (v.attachmentMime ?? "application/octet-stream") : null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const { data: existing } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).single();
      if (existing) return { ok: true, message: existing };
    }
    console.error("[chat] send failed", error);
    return { ok: false, error: "Message not sent. Please try again." };
  }
  await supabase.rpc("mark_conversation_read", { p_conversation: v.conversationId });
  await notifyRecipientOfMessage({ conversationId: v.conversationId, senderId: profile.id, body: data.body, kind: data.kind });
  return { ok: true, message: data };
}

export async function editChatMessage(input: { id: string; body: string }): Promise<Result<{ message: ChatMessage }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = z.object({ id: z.uuid(), body: z.string().trim().min(1, "Message can't be empty.").max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid edit." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.id)
    .eq("sender_id", profile.id)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't edit that message." };
  return { ok: true, message: data };
}

export async function deleteChatMessage(input: { id: string }): Promise<Result<{ message: ChatMessage }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid message." };
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("messages")
    .select("attachment_path")
    .eq("id", id.data)
    .eq("sender_id", profile.id)
    .maybeSingle();
  const { data, error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("sender_id", profile.id)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't delete that message." };
  if (before?.attachment_path && isOwnPath(profile.id, before.attachment_path)) {
    await supabase.storage.from(CHAT_BUCKET).remove([before.attachment_path]);
  }
  return { ok: true, message: data };
}

/** Client shares one of their workout logs into the thread. */
export async function shareWorkout(input: { id: string; conversationId: string; workoutLogId: string }): Promise<Result<{ message: ChatMessage }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = z.object({ id: z.uuid(), conversationId: z.uuid(), workoutLogId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid workout." };
  const supabase = await createClient();
  const { data: log } = await supabase
    .from("workout_logs")
    .select("id, client_id, performed_on, duration_minutes, session_rpe, feedback, program_workouts(name)")
    .eq("id", parsed.data.workoutLogId)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!log) return { ok: false, error: "Workout not found." };
  const name = log.program_workouts?.name ?? "Workout";
  const parts = [
    `${name} · ${formatDate(`${log.performed_on}T12:00:00Z`, "UTC", "EEE, MMM d")}`,
    log.duration_minutes ? `${log.duration_minutes} min` : null,
    log.session_rpe ? `RPE ${log.session_rpe}` : null,
  ].filter(Boolean);
  const body = [parts.join(" · "), log.feedback?.trim()].filter(Boolean).join("\n");
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id: parsed.data.id,
      conversation_id: parsed.data.conversationId,
      sender_id: profile.id,
      kind: "workout_share",
      body,
      workout_log_id: log.id,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't share that workout." };
  await supabase.rpc("mark_conversation_read", { p_conversation: parsed.data.conversationId });
  await notifyRecipientOfMessage({ conversationId: parsed.data.conversationId, senderId: profile.id, body, kind: "workout_share" });
  return { ok: true, message: data };
}

/** Trainer starts an ad-hoc video call: create a room and post the join link in the thread. */
export async function startVideoCall(input: { clientId: string }): Promise<Result<{ url: string }>> {
  const profile = await getProfile();
  if (!profile || profile.role === "client") return { ok: false, error: "Only coaches can start calls." };
  const clientId = z.uuid().safeParse(input.clientId);
  if (!clientId.success) return { ok: false, error: "Invalid client." };
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("trainer_clients")
    .select("client_id")
    .eq("trainer_id", profile.id)
    .eq("client_id", clientId.data)
    .maybeSingle();
  if (!rel) return { ok: false, error: "Client not found." };

  const url = await createVideoRoom({
    bookingId: `call-${crypto.randomUUID()}`,
    endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  await sendSystemMessage({
    trainerId: profile.id,
    clientId: clientId.data,
    body: `${displayName(profile)} started a video call. Join here: ${url}`,
  });
  await notify({
    userId: clientId.data,
    type: "video_call",
    title: `${displayName(profile)} started a video call`,
    body: "Tap to join from your messages.",
    link: "/me/messages",
    email: false,
  });
  return { ok: true, url };
}
