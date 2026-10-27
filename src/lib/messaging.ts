import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import { newMessageEmail } from "@/lib/emails/new-message";
import {
  fileExtension,
  messagePreview,
  shouldEmailRecipient,
  uploadPath,
  validateUpload,
  type CommsBucket,
} from "@/lib/comms/policy";

// OWNER: communication.

/**
 * Drop an event into the trainer/client chat thread (e.g. "Booked: Tue 6:00am",
 * "New program assigned"). Uses the service role; callers pass ids they have
 * already authorized. Never throws.
 */
export async function sendSystemMessage(input: {
  trainerId: string;
  clientId: string;
  body: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: conversationId, error } = await admin.rpc("ensure_conversation", {
      p_trainer: input.trainerId,
      p_client: input.clientId,
    });
    if (error || !conversationId) throw error ?? new Error("no conversation");
    const { error: insertError } = await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: input.trainerId,
      kind: "system",
      body: input.body.slice(0, 4000),
    });
    if (insertError) throw insertError;
  } catch (err) {
    console.error("[messaging] sendSystemMessage failed", err);
  }
}

export type SignedUpload = { bucket: CommsBucket; path: string; signedUrl: string; token: string };

/**
 * Signed upload URL for a browser → storage upload at `<uploader_id>/<uuid>.<ext>`.
 * Created with the user's own client, so storage RLS ("own folder write") applies.
 */
export async function createSignedUpload(input: {
  uploaderId: string;
  bucket: CommsBucket;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<{ ok: true; upload: SignedUpload } | { ok: false; error: string }> {
  const check = validateUpload(input.bucket, { size: input.size, contentType: input.contentType });
  if (!check.ok) return check;
  const path = uploadPath(input.uploaderId, randomUUID(), fileExtension(input.fileName, input.contentType));
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(input.bucket).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[messaging] createSignedUploadUrl failed", error);
    return { ok: false, error: "Could not start the upload. Please try again." };
  }
  return { ok: true, upload: { bucket: input.bucket, path: data.path, signedUrl: data.signedUrl, token: data.token } };
}

/** Signed read URL (RLS client: storage policies decide who may read). */
export async function signedReadUrl(bucket: CommsBucket, path: string, expiresIn = 60 * 60): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) console.error("[messaging] createSignedUrl failed", path, error.message);
  return data?.signedUrl ?? null;
}

/** Signed read URLs for many paths at once → `{ [path]: url }`. */
export async function signedReadUrls(
  bucket: CommsBucket,
  paths: (string | null | undefined)[],
  expiresIn = 60 * 60,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!unique.length) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, expiresIn);
  if (error) console.error("[messaging] createSignedUrls failed", error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

/**
 * After a chat message: email (and bell-notify) the recipient only when they
 * haven't looked at the thread for 10+ minutes, once per unread streak.
 * The conditional update guards against two messages racing to send twice.
 */
export async function notifyRecipientOfMessage(input: {
  conversationId: string;
  senderId: string;
  body: string | null;
  kind: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: c } = await admin
      .from("conversations")
      .select("id, trainer_id, client_id, trainer_last_read_at, client_last_read_at, trainer_emailed_at, client_emailed_at")
      .eq("id", input.conversationId)
      .single();
    if (!c) return;
    const senderIsTrainer = c.trainer_id === input.senderId;
    const recipientId = senderIsTrainer ? c.client_id : c.trainer_id;
    const lastReadAt = senderIsTrainer ? c.client_last_read_at : c.trainer_last_read_at;
    const lastEmailedAt = senderIsTrainer ? c.client_emailed_at : c.trainer_emailed_at;
    if (!shouldEmailRecipient({ lastReadAt, lastEmailedAt })) return;

    const column = senderIsTrainer ? "client_emailed_at" : "trainer_emailed_at";
    const stamp = new Date().toISOString();
    let claim = admin
      .from("conversations")
      .update(senderIsTrainer ? { client_emailed_at: stamp } : { trainer_emailed_at: stamp })
      .eq("id", c.id);
    claim = lastEmailedAt ? claim.eq(column, lastEmailedAt) : claim.is(column, null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) return;

    const { data: people } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [input.senderId, recipientId]);
    const sender = people?.find((p) => p.id === input.senderId);
    const recipient = people?.find((p) => p.id === recipientId);
    if (!recipient) return;
    const senderName = displayName(sender);
    const link = senderIsTrainer ? "/me/messages" : `/coach/messages/${c.client_id}`;
    const preview = messagePreview({ body: input.body, kind: input.kind });

    await notify({ userId: recipientId, type: "message", title: `New message from ${senderName}`, body: preview, link });
    if (recipient.email) {
      await sendEmail(
        newMessageEmail({ to: recipient.email, recipientName: recipient.full_name, senderName, preview, link }),
      );
    }
  } catch (err) {
    console.error("[messaging] notifyRecipientOfMessage failed", err);
  }
}
