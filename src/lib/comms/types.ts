import type { Tables } from "@/lib/supabase/database.types";

export type ChatMessage = Pick<
  Tables<"messages">,
  | "id"
  | "conversation_id"
  | "sender_id"
  | "kind"
  | "body"
  | "attachment_path"
  | "attachment_mime"
  | "workout_log_id"
  | "video_submission_id"
  | "edited_at"
  | "deleted_at"
  | "created_at"
>;

export const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, kind, body, attachment_path, attachment_mime, workout_log_id, video_submission_id, edited_at, deleted_at, created_at" as const;

export type VideoComment = Pick<Tables<"video_comments">, "id" | "submission_id" | "author_id" | "timestamp_seconds" | "body" | "created_at">;

export const COMMENT_COLUMNS = "id, submission_id, author_id, timestamp_seconds, body, created_at" as const;

export type Person = { id: string; name: string; avatarUrl: string | null };
