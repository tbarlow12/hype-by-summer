import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedReadUrls } from "@/lib/messaging";
import { CHAT_BUCKET } from "@/lib/comms/policy";
import { MESSAGE_COLUMNS, type ChatMessage, type Person } from "@/lib/comms/types";
import { displayName, formatDate } from "@/lib/format";
import type { Enums } from "@/lib/supabase/database.types";

export type InboxRow = {
  conversation_id: string;
  client_id: string;
  client_name: string | null;
  client_email: string;
  client_avatar_url: string | null;
  last_message_at: string | null;
  last_body: string | null;
  last_kind: Enums<"message_kind"> | null;
  last_sender_id: string | null;
  last_deleted: boolean;
  unread_count: number;
  /** The client's primary coach in this business (for the "Mine" filter). */
  primary_coach_id: string | null;
};

/**
 * The team inbox of one business: every client thread with the shared
 * staff unread count (RLS applies: the caller must be staff of it).
 */
export async function loadInbox(businessId: string): Promise<InboxRow[]> {
  const supabase = await createClient();
  const [{ data, error }, { data: rels }] = await Promise.all([
    supabase.rpc("conversation_inbox", { p_business: businessId }),
    supabase.from("business_clients").select("client_id, primary_coach_id").eq("business_id", businessId),
  ]);
  if (error) console.error("[chat] inbox failed", error);
  const coachOf = new Map((rels ?? []).map((r) => [r.client_id, r.primary_coach_id]));
  return (data ?? []).map((r) => ({
    conversation_id: r.conversation_id!,
    client_id: r.client_id!,
    client_name: r.client_name,
    client_email: r.client_email ?? "",
    client_avatar_url: r.client_avatar_url,
    last_message_at: r.last_message_at,
    last_body: r.last_body,
    last_kind: r.last_kind,
    last_sender_id: r.last_sender_id,
    last_deleted: Boolean(r.last_deleted),
    unread_count: r.unread_count ?? 0,
    primary_coach_id: coachOf.get(r.client_id!) ?? null,
  }));
}

export const THREAD_PAGE_SIZE = 50;

/** Ensure the client's thread with the business exists (RLS/RPC re-checks access). */
export async function ensureConversationId(businessId: string, clientId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_conversation", { p_business: businessId, p_client: clientId });
  if (error) console.error("[chat] ensure_conversation failed", error);
  return data ?? null;
}

/**
 * Names and avatars of the business's active team (everyone who can write on
 * the business's side of a thread) plus any other given ids (past senders). Service role,
 * scoped to one business the caller belongs to (as staff or client).
 */
export async function teamPeople(businessId: string, extraIds: (string | null)[] = []): Promise<Record<string, Person>> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("active", true);
  const ids = [...new Set([...(members ?? []).map((m) => m.user_id), ...extraIds.filter((x): x is string => Boolean(x))])];
  if (!ids.length) return {};
  const { data: profiles } = await admin.from("profiles").select("id, full_name, email, avatar_url").in("id", ids);
  const out: Record<string, Person> = {};
  for (const p of profiles ?? []) out[p.id] = { id: p.id, name: displayName(p), avatarUrl: p.avatar_url };
  return out;
}

/**
 * Latest page of a thread + signed attachment URLs + read state, as the
 * signed-in viewer (staff share one read marker; the client has their own).
 */
export async function loadThread(conversationId: string, viewer: "staff" | "client") {
  const supabase = await createClient();
  const [{ data: convo }, { data: rows }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, business_id, client_id, staff_last_read_at, client_last_read_at")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(THREAD_PAGE_SIZE),
  ]);
  if (!convo) return null;
  const messages: ChatMessage[] = (rows ?? []).reverse();
  const isStaff = viewer === "staff";
  const myReadAt = isStaff ? convo.staff_last_read_at : convo.client_last_read_at;
  const fromOtherSide = (m: ChatMessage) =>
    m.sender_id !== null && (isStaff ? m.sender_id === convo.client_id : m.sender_id !== convo.client_id);
  const unread = messages.filter((m) => fromOtherSide(m) && !m.deleted_at && (!myReadAt || m.created_at > myReadAt)).length;
  const [urls, people] = await Promise.all([
    signedReadUrls(CHAT_BUCKET, messages.map((m) => m.attachment_path)),
    teamPeople(
      convo.business_id,
      messages.map((m) => m.sender_id),
    ),
  ]);
  return {
    conversation: convo,
    messages,
    urls,
    people,
    hasMore: (rows ?? []).length === THREAD_PAGE_SIZE,
    unread,
    otherLastReadAt: isStaff ? convo.client_last_read_at : convo.staff_last_read_at,
  };
}

/** A client's recent workout logs with one business, labelled for the "share a workout" picker. */
export async function shareableWorkouts(clientId: string, businessId: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workout_logs")
    .select("id, performed_on, duration_minutes, program_workouts(name)")
    .eq("client_id", clientId)
    .eq("business_id", businessId)
    .order("performed_on", { ascending: false })
    .limit(10);
  return (data ?? []).map((l) => ({
    id: l.id,
    label: [
      l.program_workouts?.name ?? "Workout",
      formatDate(`${l.performed_on}T12:00:00Z`, "UTC", "EEE, MMM d"),
      l.duration_minutes ? `${l.duration_minutes} min` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}
