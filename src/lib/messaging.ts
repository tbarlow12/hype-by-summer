import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { brandForBusiness } from "@/lib/tenant";
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
 * Drop an event into a client's thread with a business (e.g. "Booked: Tue
 * 6:00am", "New program assigned"). Shown to the client and the whole team.
 * Uses the service role; callers pass ids they have already authorized
 * (the client must be a client of that business). Never throws.
 */
export async function sendSystemMessage(input: { businessId: string; clientId: string; body: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: conversationId, error } = await admin.rpc("ensure_conversation", {
      p_business: input.businessId,
      p_client: input.clientId,
    });
    if (error || !conversationId) throw error ?? new Error("no conversation");
    const { error: insertError } = await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: null,
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
 * Signed upload URL for a browser → storage upload at `<folder>/<uuid>.<ext>`.
 * `folder` is the uploader's own id, or (staff chat files) the business id.
 * Created with the user's own client, so storage RLS applies.
 */
export async function createSignedUpload(input: {
  folder: string;
  bucket: CommsBucket;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<{ ok: true; upload: SignedUpload } | { ok: false; error: string }> {
  const check = validateUpload(input.bucket, { size: input.size, contentType: input.contentType });
  if (!check.ok) return check;
  const path = uploadPath(input.folder, randomUUID(), fileExtension(input.fileName, input.contentType));
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
 * Who on the team hears about a client's activity: the client's primary coach
 * when they're an active member, otherwise the owners/admins. Service role;
 * the caller authorized the business/client pair.
 */
export async function teamRecipients(businessId: string, clientId: string, preferredCoachId?: string | null): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: rel }, { data: members }] = await Promise.all([
    admin.from("business_clients").select("primary_coach_id").eq("business_id", businessId).eq("client_id", clientId).maybeSingle(),
    admin.from("business_members").select("user_id, role").eq("business_id", businessId).eq("active", true),
  ]);
  const active = new Set((members ?? []).map((m) => m.user_id));
  for (const id of [preferredCoachId, rel?.primary_coach_id]) if (id && active.has(id)) return [id];
  return (members ?? []).filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.user_id);
}

/**
 * After a chat message: email (and bell-notify) the other side only when they
 * haven't looked at the thread for 10+ minutes, once per unread streak.
 * Client messages go to the client's primary coach (else the managers); team
 * messages go to the client. The conditional update guards against two
 * messages racing to send twice. Never throws.
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
      .select("id, business_id, client_id, staff_last_read_at, client_last_read_at, staff_emailed_at, client_emailed_at")
      .eq("id", input.conversationId)
      .single();
    if (!c) return;
    const fromTeam = c.client_id !== input.senderId;
    const lastReadAt = fromTeam ? c.client_last_read_at : c.staff_last_read_at;
    const lastEmailedAt = fromTeam ? c.client_emailed_at : c.staff_emailed_at;
    if (!shouldEmailRecipient({ lastReadAt, lastEmailedAt })) return;

    const column = fromTeam ? "client_emailed_at" : "staff_emailed_at";
    const stamp = new Date().toISOString();
    let claim = admin
      .from("conversations")
      .update(fromTeam ? { client_emailed_at: stamp } : { staff_emailed_at: stamp })
      .eq("id", c.id);
    claim = lastEmailedAt ? claim.eq(column, lastEmailedAt) : claim.is(column, null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) return;

    const recipientIds = fromTeam ? [c.client_id] : await teamRecipients(c.business_id, c.client_id);
    if (!recipientIds.length) return;
    const [brand, { data: people }] = await Promise.all([
      brandForBusiness(c.business_id),
      admin.from("profiles").select("id, full_name, email").in("id", [input.senderId, ...recipientIds]),
    ]);
    const sender = people?.find((p) => p.id === input.senderId);
    const senderName = fromTeam ? `${displayName(sender)} (${brand.name})` : displayName(sender);
    const link = fromTeam ? "/me/messages" : `/coach/messages/${c.client_id}`;
    const preview = messagePreview({ body: input.body, kind: input.kind });

    for (const recipientId of recipientIds) {
      const recipient = people?.find((p) => p.id === recipientId);
      if (!recipient) continue;
      await notify({
        userId: recipientId,
        businessId: c.business_id,
        type: "message",
        title: `New message from ${senderName}`,
        body: preview,
        link,
      });
      if (recipient.email) {
        await sendEmail(
          newMessageEmail({ brand, to: recipient.email, recipientName: recipient.full_name, senderName, preview, link }),
        );
      }
    }
  } catch (err) {
    console.error("[messaging] notifyRecipientOfMessage failed", err);
  }
}
