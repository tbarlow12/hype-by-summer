import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { loadSubmission } from "@/lib/comms/videos";
import { VideoReview } from "@/components/comms/video-review";
import { ReviewerSelect } from "@/components/comms/reviewer-select";

export const metadata = { title: "Review form check" };

export default async function CoachVideoPage({ params }: PageProps<"/coach/videos/[id]">) {
  const { profile, business } = await requireStaff();
  const { id } = await params;
  const data = await loadSubmission(id, business.id);
  if (!data) notFound();
  const client = data.people[data.submission.client_id];

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("business_members")
    .select("user_id, profiles!business_members_user_id_fkey(full_name, email)")
    .eq("business_id", business.id)
    .eq("active", true);
  const team = (members ?? [])
    .map((m) => ({ id: m.user_id, name: displayName(m.profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const reviewedBy = data.submission.reviewed_by
    ? data.submission.reviewed_by === profile.id
      ? "you"
      : (data.people[data.submission.reviewed_by]?.name ?? "a former teammate")
    : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/coach/videos" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Review queue
        </Link>
        <div className="flex gap-3 text-sm font-medium">
          <Link href={`/coach/videos?view=all&client=${data.submission.client_id}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            All videos from {client?.name ?? "this client"}
          </Link>
          <Link href={`/coach/messages/${data.submission.client_id}`} className="text-brand hover:underline">
            Message
          </Link>
        </div>
      </div>
      <VideoReview
        submission={data.submission}
        videoUrl={data.videoUrl}
        initialComments={data.comments}
        people={data.people}
        viewerId={profile.id}
        isStaff
        timezone={profile.timezone}
        reviewedBy={reviewedBy}
        reviewerControl={
          <ReviewerSelect submissionId={data.submission.id} value={data.submission.coach_id} team={team} viewerId={profile.id} />
        }
      />
    </div>
  );
}
