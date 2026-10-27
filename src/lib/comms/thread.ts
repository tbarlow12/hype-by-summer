import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedReadUrls } from "@/lib/messaging";
import { CHAT_BUCKET } from "@/lib/comms/policy";
import { MESSAGE_COLUMNS, type ChatMessage } from "@/lib/comms/types";
import { formatDate } from "@/lib/format";
import type { Enums } from "@/lib/supabase/database.types";

export type InboxRow = {
  conversation_id: string;
  trainer_id: string;
  client_id: string;
  other_id: string;
  other_name: string | null;
  other_email: string;
  other_avatar_url: string | null;
  last_message_at: string | null;
  last_body: string | null;
  last_kind: Enums<"message_kind"> | null;
  last_sender_id: string | null;
  last_deleted: boolean;
  unread_count: number;
};

/** Inbox rows for the signed-in user (RLS applies). */
export async function loadInbox(): Promise<InboxRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("conversation_inbox");
  if (error) console.error("[chat] inbox failed", error);
  return (data ?? []) as InboxRow[];
}

export const THREAD_PAGE_SIZE = 50;

/** Ensure the trainer/client conversation exists (caller verified the relationship). */
export async function ensureConversationId(trainerId: string, clientId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_conversation", { p_trainer: trainerId, p_client: clientId });
  if (error) console.error("[chat] ensure_conversation failed", error);
  return data ?? null;
}

/** Latest page of a thread + signed attachment URLs + read state, as the signed-in member. */
export async function loadThread(conversationId: string, viewerId: string) {
  const supabase = await createClient();
  const [{ data: convo }, { data: rows }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, trainer_id, client_id, trainer_last_read_at, client_last_read_at")
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
  const viewerIsTrainer = convo.trainer_id === viewerId;
  const myReadAt = viewerIsTrainer ? convo.trainer_last_read_at : convo.client_last_read_at;
  const unread = messages.filter(
    (m) => m.sender_id !== viewerId && !m.deleted_at && (!myReadAt || m.created_at > myReadAt),
  ).length;
  const urls = await signedReadUrls(CHAT_BUCKET, messages.map((m) => m.attachment_path));
  return {
    conversation: convo,
    messages,
    urls,
    hasMore: (rows ?? []).length === THREAD_PAGE_SIZE,
    unread,
    otherLastReadAt: viewerIsTrainer ? convo.client_last_read_at : convo.trainer_last_read_at,
  };
}

/** A client's recent workout logs, labelled for the "share a workout" picker. */
export async function shareableWorkouts(clientId: string): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workout_logs")
    .select("id, performed_on, duration_minutes, program_workouts(name)")
    .eq("client_id", clientId)
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
