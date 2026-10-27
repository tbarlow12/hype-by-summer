import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signedReadUrl } from "@/lib/messaging";
import { VIDEO_BUCKET } from "@/lib/comms/policy";
import { COMMENT_COLUMNS, type Person, type VideoComment } from "@/lib/comms/types";
import { displayName } from "@/lib/format";

/** A form-check submission with its signed video URL, comments and participants (RLS applies). */
export async function loadSubmission(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select("id, client_id, trainer_id, title, status, client_note, duration_seconds, created_at, reviewed_at, storage_path, exercises(name)")
    .eq("id", id)
    .maybeSingle();
  if (!sub) return null;
  const [videoUrl, { data: comments }, { data: profiles }] = await Promise.all([
    signedReadUrl(VIDEO_BUCKET, sub.storage_path, 60 * 60 * 3),
    supabase.from("video_comments").select(COMMENT_COLUMNS).eq("submission_id", sub.id).order("created_at"),
    supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", [sub.client_id, sub.trainer_id]),
  ]);
  const people: Record<string, Person> = {};
  for (const p of profiles ?? []) people[p.id] = { id: p.id, name: displayName(p), avatarUrl: p.avatar_url };
  return {
    submission: {
      id: sub.id,
      client_id: sub.client_id,
      trainer_id: sub.trainer_id,
      title: sub.title,
      status: sub.status,
      client_note: sub.client_note,
      duration_seconds: sub.duration_seconds,
      created_at: sub.created_at,
      exercise: sub.exercises?.name ?? null,
    },
    videoUrl,
    comments: (comments ?? []) as VideoComment[],
    people,
  };
}
