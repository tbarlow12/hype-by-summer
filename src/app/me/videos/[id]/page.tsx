import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { loadSubmission } from "@/lib/comms/videos";
import { VideoReview } from "@/components/comms/video-review";
import { DeleteVideoButton } from "@/components/comms/delete-video-button";

export const metadata = { title: "Form check" };

export default async function ClientVideoPage({ params }: PageProps<"/me/videos/[id]">) {
  const { profile, business } = await requireClient();
  const { id } = await params;
  const data = await loadSubmission(id, business.id);
  if (!data || data.submission.client_id !== profile.id) notFound();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/me/videos" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← All form checks
        </Link>
        {data.submission.status !== "reviewed" ? <DeleteVideoButton id={data.submission.id} /> : null}
      </div>
      <VideoReview
        submission={data.submission}
        videoUrl={data.videoUrl}
        initialComments={data.comments}
        people={data.people}
        viewerId={profile.id}
        isStaff={false}
        timezone={profile.timezone}
        reviewedBy={data.submission.reviewed_by ? (data.people[data.submission.reviewed_by]?.name ?? null) : null}
      />
    </div>
  );
}
