"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { sendEmail } from "@/lib/email";
import { sendSystemMessage } from "@/lib/messaging";
import { displayName } from "@/lib/format";
import { videoReviewedEmail } from "@/lib/emails/video-reviewed";
import { VIDEO_BUCKET, isOwnPath } from "@/lib/comms/policy";
import { COMMENT_COLUMNS, type VideoComment } from "@/lib/comms/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const submissionSchema = z.object({
  path: z.string().max(300),
  mime: z.string().max(255).refine((m) => m.toLowerCase().startsWith("video/"), "Please upload a video."),
  title: z.string().trim().min(1, "Give your video a title.").max(120),
  note: z.string().trim().max(2000).optional(),
  exerciseId: z.uuid().optional(),
  durationSeconds: z.number().min(0).max(60 * 60 * 3).optional(),
});

/** Client: record a form-check video after the browser finished uploading it. */
export async function createVideoSubmission(input: z.infer<typeof submissionSchema>): Promise<Result<{ id: string }>> {
  const profile = await getProfile();
  if (!profile || profile.role !== "client") return { ok: false, error: "Please sign in as a client." };
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid video." };
  const v = parsed.data;
  if (!isOwnPath(profile.id, v.path)) return { ok: false, error: "Invalid upload." };
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) return { ok: false, error: "You're not connected with a coach yet." };

  const supabase = await createClient();
  if (v.exerciseId) {
    const { data: ex } = await supabase.from("exercises").select("id").eq("id", v.exerciseId).maybeSingle();
    if (!ex) return { ok: false, error: "Unknown exercise." };
  }
  const { data, error } = await supabase
    .from("video_submissions")
    .insert({
      client_id: profile.id,
      trainer_id: trainerId,
      exercise_id: v.exerciseId ?? null,
      title: v.title,
      client_note: v.note || null,
      storage_path: v.path,
      mime_type: v.mime,
      duration_seconds: v.durationSeconds ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[videos] insert failed", error);
    return { ok: false, error: "Couldn't save your video. Please try again." };
  }
  await notify({
    userId: trainerId,
    type: "form_check",
    title: `${displayName(profile)} sent a form check`,
    body: v.title,
    link: `/coach/videos/${data.id}`,
  });
  revalidatePath("/me/videos");
  return { ok: true, id: data.id };
}

/** Client: delete one of their own submissions that hasn't been reviewed yet. */
export async function deleteVideoSubmission(input: { id: string }): Promise<Result> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select("id, storage_path, status")
    .eq("id", id.data)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!sub) return { ok: false, error: "Video not found." };
  if (sub.status === "reviewed") return { ok: false, error: "Reviewed videos are kept so you can revisit the feedback." };
  const { error } = await supabase.from("video_submissions").delete().eq("id", sub.id);
  if (error) return { ok: false, error: "Couldn't delete the video." };
  await supabase.storage.from(VIDEO_BUCKET).remove([sub.storage_path]);
  revalidatePath("/me/videos");
  return { ok: true };
}

const commentSchema = z.object({
  id: z.uuid(),
  submissionId: z.uuid(),
  body: z.string().trim().min(1, "Write a comment.").max(2000),
  timestampSeconds: z.number().min(0).max(60 * 60 * 3).nullable(),
});

export async function addVideoComment(input: z.infer<typeof commentSchema>): Promise<Result<{ comment: VideoComment }>> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select("id, client_id, trainer_id, title, status")
    .eq("id", v.submissionId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "Video not found." };
  const { data, error } = await supabase
    .from("video_comments")
    .insert({
      id: v.id,
      submission_id: sub.id,
      author_id: profile.id,
      body: v.body,
      timestamp_seconds: v.timestampSeconds === null ? null : Math.round(v.timestampSeconds * 10) / 10,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't post the comment." };

  // Clients' replies ping the coach; coach notes ping the client only once the review is out.
  if (profile.id === sub.client_id) {
    await notify({
      userId: sub.trainer_id,
      type: "form_check_reply",
      title: `${displayName(profile)} replied on "${sub.title}"`,
      body: v.body.slice(0, 140),
      link: `/coach/videos/${sub.id}`,
    });
  } else if (sub.status === "reviewed") {
    await notify({
      userId: sub.client_id,
      type: "form_check_comment",
      title: `New note on "${sub.title}"`,
      body: v.body.slice(0, 140),
      link: `/me/videos/${sub.id}`,
    });
  }
  return { ok: true, comment: data };
}

export async function deleteVideoComment(input: { id: string }): Promise<Result> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Please sign in again." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid comment." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("video_comments").delete().eq("id", id.data).eq("author_id", profile.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't delete the comment." };
  return { ok: true };
}

/** Trainer: mark a form check reviewed and let the client know (bell + email + chat note). */
export async function markVideoReviewed(input: { id: string }): Promise<Result> {
  const profile = await getProfile();
  if (!profile || profile.role === "client") return { ok: false, error: "Only coaches can review videos." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("trainer_id", profile.id)
    .neq("status", "reviewed")
    .select("id, client_id, title, profiles!video_submissions_client_id_fkey(full_name, email)")
    .maybeSingle();
  if (!sub) return { ok: false, error: "Video not found or already reviewed." };

  const { count } = await supabase
    .from("video_comments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", sub.id)
    .eq("author_id", profile.id);
  const trainerName = displayName(profile);
  await notify({
    userId: sub.client_id,
    type: "form_check_reviewed",
    title: `${trainerName} reviewed "${sub.title}"`,
    body: count ? `${count} coaching note${count === 1 ? "" : "s"} waiting for you.` : "Your form check has been reviewed.",
    link: `/me/videos/${sub.id}`,
  });
  if (sub.profiles?.email) {
    await sendEmail(
      videoReviewedEmail({
        to: sub.profiles.email,
        clientName: sub.profiles.full_name,
        trainerName,
        videoTitle: sub.title,
        commentCount: count ?? 0,
        submissionId: sub.id,
      }),
    );
  }
  await sendSystemMessage({ trainerId: profile.id, clientId: sub.client_id, body: `Form check reviewed: "${sub.title}". See the notes in Form checks.` });
  revalidatePath("/coach/videos");
  revalidatePath(`/coach/videos/${sub.id}`);
  return { ok: true };
}

/** Trainer: put a reviewed video back in the queue. */
export async function reopenVideo(input: { id: string }): Promise<Result> {
  const profile = await getProfile();
  if (!profile || profile.role === "client") return { ok: false, error: "Only coaches can do that." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("video_submissions")
    .update({ status: "pending_review", reviewed_at: null })
    .eq("id", id.data)
    .eq("trainer_id", profile.id)
    .select("id");
  if (!data?.length) return { ok: false, error: "Video not found." };
  revalidatePath("/coach/videos");
  revalidatePath(`/coach/videos/${id.data}`);
  return { ok: true };
}
