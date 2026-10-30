"use server";

import { z } from "zod";
import { getMembership, getProfile, type Membership, type Profile } from "@/lib/auth";
import { getBusiness, type Business } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createVideoRoom } from "@/lib/video";
import { notify } from "@/lib/notify";
import { createSignedUpload, notifyRecipientOfMessage, sendSystemMessage, type SignedUpload } from "@/lib/messaging";
import { CHAT_BUCKET, VIDEO_BUCKET, isOwnPath, kindForMime } from "@/lib/comms/policy";
import { formatDate, displayName } from "@/lib/format";
import { MESSAGE_COLUMNS, type ChatMessage } from "@/lib/comms/types";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

type Viewer = { profile: Profile; business: Business; membership: Membership | null };

/** Signed-in person on the current business's site (staff or client). */
async function viewer(): Promise<Viewer | null> {
  const [profile, business] = await Promise.all([getProfile(), getBusiness()]);
  if (!profile || !business) return null;
  return { profile, business, membership: await getMembership() };
}

/** Staff chat files live in the business folder (shared by the team); clients use their own. */
function chatFolder(v: Viewer): string {
  return v.membership ? v.business.id : v.profile.id;
}

/**
 * A thread of the current business the viewer may write in: any thread for
 * staff, only their own for a client.
 */
async function writableConversation(v: Viewer, conversationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, business_id, client_id")
    .eq("id", conversationId)
    .eq("business_id", v.business.id)
    .maybeSingle();
  if (!data) return null;
  if (!v.membership && data.client_id !== v.profile.id) return null;
  return data;
}

const uploadSchema = z.object({
  bucket: z.enum([CHAT_BUCKET, VIDEO_BUCKET]),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(255),
  size: z.number().int().positive(),
});

/** Step 1 of a browser upload: a signed URL in the right folder (see chatFolder). */
export async function requestUpload(input: z.infer<typeof uploadSchema>): Promise<Result<{ upload: SignedUpload }>> {
  const v = await viewer();
  if (!v) return { ok: false, error: "Please sign in again." };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid file." };
  if (parsed.data.bucket === VIDEO_BUCKET && v.membership) return { ok: false, error: "Form checks are uploaded by clients." };
  return createSignedUpload({
    folder: parsed.data.bucket === CHAT_BUCKET ? chatFolder(v) : v.profile.id,
    ...parsed.data,
    contentType: parsed.data.contentType || "application/octet-stream",
  });
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
  const ctx = await viewer();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message." };
  const v = parsed.data;
  if (v.attachmentPath && !isOwnPath(chatFolder(ctx), v.attachmentPath)) return { ok: false, error: "Invalid attachment." };
  const convo = await writableConversation(ctx, v.conversationId);
  if (!convo) return { ok: false, error: "Conversation not found." };

  const supabase = await createClient();
  // RLS: sender must be me and a member of the conversation.
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id: v.id,
      conversation_id: convo.id,
      sender_id: ctx.profile.id,
      kind: v.attachmentPath ? kindForMime(v.attachmentMime) : "text",
      body: v.body || null,
      attachment_path: v.attachmentPath ?? null,
      attachment_mime: v.attachmentPath ? (v.attachmentMime ?? "application/octet-stream") : null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const { data: existing } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", v.id).eq("sender_id", ctx.profile.id).maybeSingle();
      if (existing) return { ok: true, message: existing };
    }
    console.error("[chat] send failed", error);
    return { ok: false, error: "Message not sent. Please try again." };
  }
  await supabase.rpc("mark_conversation_read", { p_conversation: convo.id });
  await notifyRecipientOfMessage({ conversationId: convo.id, senderId: ctx.profile.id, body: data.body, kind: data.kind });
  return { ok: true, message: data };
}

export async function editChatMessage(input: { id: string; body: string }): Promise<Result<{ message: ChatMessage }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = z.object({ id: z.uuid(), body: z.string().trim().min(1, "Message can't be empty.").max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid edit." };
  const supabase = await createClient();
  // RLS + column grants: only my own message's body.
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
  const ctx = await viewer();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid message." };
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("messages")
    .select("attachment_path")
    .eq("id", id.data)
    .eq("sender_id", ctx.profile.id)
    .maybeSingle();
  const { data, error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("sender_id", ctx.profile.id)
    .select(MESSAGE_COLUMNS)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't delete that message." };
  if (before?.attachment_path && isOwnPath(chatFolder(ctx), before.attachment_path)) {
    await supabase.storage.from(CHAT_BUCKET).remove([before.attachment_path]);
  }
  return { ok: true, message: data };
}

/** Client shares one of their workout logs (with this business) into their thread. */
export async function shareWorkout(input: { id: string; conversationId: string; workoutLogId: string }): Promise<Result<{ message: ChatMessage }>> {
  const ctx = await viewer();
  if (!ctx || ctx.membership) return { ok: false, error: "Only clients can share workouts." };
  const parsed = z.object({ id: z.uuid(), conversationId: z.uuid(), workoutLogId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid workout." };
  const convo = await writableConversation(ctx, parsed.data.conversationId);
  if (!convo) return { ok: false, error: "Conversation not found." };
  const supabase = await createClient();
  const { data: log } = await supabase
    .from("workout_logs")
    .select("id, client_id, performed_on, duration_minutes, session_rpe, feedback, program_workouts(name)")
    .eq("id", parsed.data.workoutLogId)
    .eq("client_id", ctx.profile.id)
    .eq("business_id", ctx.business.id)
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
      conversation_id: convo.id,
      sender_id: ctx.profile.id,
      kind: "workout_share",
      body,
      workout_log_id: log.id,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't share that workout." };
  await supabase.rpc("mark_conversation_read", { p_conversation: convo.id });
  await notifyRecipientOfMessage({ conversationId: convo.id, senderId: ctx.profile.id, body, kind: "workout_share" });
  return { ok: true, message: data };
}

/** Staff start an ad-hoc video call: create a room and post the join link in the client's thread. */
export async function startVideoCall(input: { clientId: string }): Promise<Result<{ url: string }>> {
  const ctx = await viewer();
  if (!ctx?.membership) return { ok: false, error: "Only coaches can start calls." };
  const clientId = z.uuid().safeParse(input.clientId);
  if (!clientId.success) return { ok: false, error: "Invalid client." };
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("business_clients")
    .select("client_id")
    .eq("business_id", ctx.business.id)
    .eq("client_id", clientId.data)
    .neq("status", "archived")
    .maybeSingle();
  if (!rel) return { ok: false, error: "Client not found." };

  const url = await createVideoRoom({
    bookingId: `call-${crypto.randomUUID()}`,
    endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  const name = displayName(ctx.profile);
  await sendSystemMessage({
    businessId: ctx.business.id,
    clientId: clientId.data,
    body: `${name} started a video call. Join here: ${url}`,
  });
  await notify({
    userId: clientId.data,
    businessId: ctx.business.id,
    type: "video_call",
    title: `${name} started a video call`,
    body: "Tap to join from your messages.",
    link: "/me/messages",
    email: false,
  });
  return { ok: true, url };
}
