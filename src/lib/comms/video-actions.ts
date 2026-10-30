"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMembership, getProfile } from "@/lib/auth";
import { brandOf, getBusiness } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify";
import { sendEmail } from "@/lib/email";
import { sendSystemMessage, teamRecipients } from "@/lib/messaging";
import { displayName } from "@/lib/format";
import { videoReviewedEmail } from "@/lib/emails/video-reviewed";
import { VIDEO_BUCKET, isOwnPath } from "@/lib/comms/policy";
import { COMMENT_COLUMNS, type VideoComment } from "@/lib/comms/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Signed-in person on the current business's site; `staff` when they're on its team. */
async function viewer() {
  const [profile, business] = await Promise.all([getProfile(), getBusiness()]);
  if (!profile || !business) return null;
  const membership = await getMembership();
  return { profile, business, staff: Boolean(membership) };
}

async function staffViewer() {
  const v = await viewer();
  return v?.staff ? v : null;
}

function revalidateVideo(id: string) {
  revalidatePath("/coach/videos");
  revalidatePath(`/coach/videos/${id}`);
  revalidatePath(`/me/videos/${id}`);
}

const submissionSchema = z.object({
  path: z.string().max(300),
  mime: z.string().max(255).refine((m) => m.toLowerCase().startsWith("video/"), "Please upload a video."),
  title: z.string().trim().min(1, "Give your video a title.").max(120),
  note: z.string().trim().max(2000).optional(),
  exerciseId: z.uuid().optional(),
  durationSeconds: z.number().min(0).max(60 * 60 * 3).optional(),
});

/**
 * Client: record a form-check video after the browser finished uploading it.
 * The reviewer defaults to the client's primary coach (else the managers are notified).
 */
export async function createVideoSubmission(input: z.infer<typeof submissionSchema>): Promise<Result<{ id: string }>> {
  const v = await viewer();
  if (!v || v.staff) return { ok: false, error: "Please sign in as a client." };
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid video." };
  const s = parsed.data;
  if (!isOwnPath(v.profile.id, s.path)) return { ok: false, error: "Invalid upload." };

  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("business_clients")
    .select("primary_coach_id, status")
    .eq("business_id", v.business.id)
    .eq("client_id", v.profile.id)
    .maybeSingle();
  if (!rel || rel.status === "archived") return { ok: false, error: `You're not training with ${v.business.name} right now.` };
  if (s.exerciseId) {
    const { data: ex } = await supabase
      .from("exercises")
      .select("id")
      .eq("id", s.exerciseId)
      .or(`business_id.is.null,business_id.eq.${v.business.id}`)
      .maybeSingle();
    if (!ex) return { ok: false, error: "Unknown exercise." };
  }
  const recipients = await teamRecipients(v.business.id, v.profile.id);
  const reviewer = rel.primary_coach_id && recipients.includes(rel.primary_coach_id) ? rel.primary_coach_id : null;

  const { data, error } = await supabase
    .from("video_submissions")
    .insert({
      business_id: v.business.id,
      client_id: v.profile.id,
      coach_id: reviewer,
      exercise_id: s.exerciseId ?? null,
      title: s.title,
      client_note: s.note || null,
      storage_path: s.path,
      mime_type: s.mime,
      duration_seconds: s.durationSeconds ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[videos] insert failed", error);
    return { ok: false, error: "Couldn't save your video. Please try again." };
  }
  for (const userId of recipients) {
    await notify({
      userId,
      businessId: v.business.id,
      type: "form_check",
      title: `${displayName(v.profile)} sent a form check`,
      body: s.title,
      link: `/coach/videos/${data.id}`,
    });
  }
  revalidatePath("/me/videos");
  return { ok: true, id: data.id };
}

/** Client: delete one of their own submissions that hasn't been reviewed yet. */
export async function deleteVideoSubmission(input: { id: string }): Promise<Result> {
  const v = await viewer();
  if (!v || v.staff) return { ok: false, error: "Please sign in again." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select("id, storage_path, status")
    .eq("id", id.data)
    .eq("business_id", v.business.id)
    .eq("client_id", v.profile.id)
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
  const v = await viewer();
  if (!v) return { ok: false, error: "Please sign in again." };
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  const c = parsed.data;
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .select("id, client_id, coach_id, title, status")
    .eq("id", c.submissionId)
    .eq("business_id", v.business.id)
    .maybeSingle();
  if (!sub || (!v.staff && sub.client_id !== v.profile.id)) return { ok: false, error: "Video not found." };
  const { data, error } = await supabase
    .from("video_comments")
    .insert({
      id: c.id,
      submission_id: sub.id,
      author_id: v.profile.id,
      body: c.body,
      timestamp_seconds: c.timestampSeconds === null ? null : Math.round(c.timestampSeconds * 10) / 10,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't post the comment." };

  // Client replies ping the reviewer (else primary coach / managers); team notes ping the client once reviewed.
  if (v.profile.id === sub.client_id) {
    for (const userId of await teamRecipients(v.business.id, sub.client_id, sub.coach_id)) {
      await notify({
        userId,
        businessId: v.business.id,
        type: "form_check_reply",
        title: `${displayName(v.profile)} replied on "${sub.title}"`,
        body: c.body.slice(0, 140),
        link: `/coach/videos/${sub.id}`,
      });
    }
  } else if (sub.status === "reviewed") {
    await notify({
      userId: sub.client_id,
      businessId: v.business.id,
      type: "form_check_comment",
      title: `New note on "${sub.title}"`,
      body: c.body.slice(0, 140),
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

/** Staff: assign (or clear) the reviewer of a form check. Must be an active team member. */
export async function assignVideoReviewer(input: { id: string; coachId: string | null }): Promise<Result> {
  const v = await staffViewer();
  if (!v) return { ok: false, error: "Only the team can assign reviewers." };
  const parsed = z.object({ id: z.uuid(), coachId: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid reviewer." };
  const supabase = await createClient();
  if (parsed.data.coachId) {
    const { data: member } = await supabase
      .from("business_members")
      .select("user_id")
      .eq("business_id", v.business.id)
      .eq("user_id", parsed.data.coachId)
      .eq("active", true)
      .maybeSingle();
    if (!member) return { ok: false, error: "That person isn't on the team." };
  }
  const { data: sub } = await supabase
    .from("video_submissions")
    .update({ coach_id: parsed.data.coachId })
    .eq("id", parsed.data.id)
    .eq("business_id", v.business.id)
    .select("id, title, client_id")
    .maybeSingle();
  if (!sub) return { ok: false, error: "Video not found." };
  if (parsed.data.coachId && parsed.data.coachId !== v.profile.id) {
    await notify({
      userId: parsed.data.coachId,
      businessId: v.business.id,
      type: "form_check_assigned",
      title: `${displayName(v.profile)} assigned you a form check`,
      body: sub.title,
      link: `/coach/videos/${sub.id}`,
    });
  }
  revalidateVideo(sub.id);
  return { ok: true };
}

/** Staff: mark a form check reviewed (reviewed_by = me) and let the client know (bell + email + chat note). */
export async function markVideoReviewed(input: { id: string }): Promise<Result> {
  const v = await staffViewer();
  if (!v) return { ok: false, error: "Only coaches can review videos." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("video_submissions")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: v.profile.id })
    .eq("id", id.data)
    .eq("business_id", v.business.id)
    .neq("status", "reviewed")
    .select("id, client_id, coach_id, title, profiles!video_submissions_client_id_fkey(full_name, email)")
    .maybeSingle();
  if (!sub) return { ok: false, error: "Video not found or already reviewed." };
  // Unassigned checks belong to whoever reviewed them.
  if (!sub.coach_id) await supabase.from("video_submissions").update({ coach_id: v.profile.id }).eq("id", sub.id);

  const { count } = await supabase
    .from("video_comments")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", sub.id)
    .neq("author_id", sub.client_id);
  const coachName = displayName(v.profile);
  await notify({
    userId: sub.client_id,
    businessId: v.business.id,
    type: "form_check_reviewed",
    title: `${coachName} reviewed "${sub.title}"`,
    body: count ? `${count} coaching note${count === 1 ? "" : "s"} waiting for you.` : "Your form check has been reviewed.",
    link: `/me/videos/${sub.id}`,
  });
  if (sub.profiles?.email) {
    await sendEmail(
      videoReviewedEmail({
        brand: brandOf(v.business),
        to: sub.profiles.email,
        clientName: sub.profiles.full_name,
        coachName,
        videoTitle: sub.title,
        commentCount: count ?? 0,
        submissionId: sub.id,
      }),
    );
  }
  await sendSystemMessage({
    businessId: v.business.id,
    clientId: sub.client_id,
    body: `${coachName} reviewed your form check "${sub.title}". See the notes in Form checks.`,
  });
  revalidateVideo(sub.id);
  return { ok: true };
}

/** Staff: put a reviewed video back in the queue. */
export async function reopenVideo(input: { id: string }): Promise<Result> {
  const v = await staffViewer();
  if (!v) return { ok: false, error: "Only coaches can do that." };
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return { ok: false, error: "Invalid video." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("video_submissions")
    .update({ status: "pending_review", reviewed_at: null, reviewed_by: null })
    .eq("id", id.data)
    .eq("business_id", v.business.id)
    .select("id");
  if (!data?.length) return { ok: false, error: "Video not found." };
  revalidateVideo(id.data);
  return { ok: true };
}
