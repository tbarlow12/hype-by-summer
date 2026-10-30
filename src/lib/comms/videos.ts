import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedReadUrl } from "@/lib/messaging";
import { teamPeople } from "@/lib/comms/thread";
import { VIDEO_BUCKET } from "@/lib/comms/policy";
import { COMMENT_COLUMNS, type VideoComment } from "@/lib/comms/types";

/**
 * A form-check submission of one business with its signed video URL,
 * comments and participants (RLS applies: staff of the business or the client).
 */
export async function loadSubmission(id: string, businessId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select(
      "id, business_id, client_id, coach_id, reviewed_by, title, status, client_note, duration_seconds, created_at, reviewed_at, storage_path, exercises(name)",
    )
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!sub) return null;
  const [videoUrl, { data: comments }] = await Promise.all([
    signedReadUrl(VIDEO_BUCKET, sub.storage_path, 60 * 60 * 3),
    supabase.from("video_comments").select(COMMENT_COLUMNS).eq("submission_id", sub.id).order("created_at"),
  ]);
  const people = await teamPeople(sub.business_id, [sub.client_id, ...(comments ?? []).map((c) => c.author_id)]);
  return {
    submission: {
      id: sub.id,
      client_id: sub.client_id,
      coach_id: sub.coach_id,
      reviewed_by: sub.reviewed_by,
      title: sub.title,
      status: sub.status,
      client_note: sub.client_note,
      duration_seconds: sub.duration_seconds,
      created_at: sub.created_at,
      reviewed_at: sub.reviewed_at,
      exercise: sub.exercises?.name ?? null,
    },
    videoUrl,
    comments: (comments ?? []) as VideoComment[],
    people,
  };
}
