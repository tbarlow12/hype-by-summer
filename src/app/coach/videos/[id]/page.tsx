import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTrainer } from "@/lib/auth";
import { loadSubmission } from "@/lib/comms/videos";
import { VideoReview } from "@/components/comms/video-review";

export const metadata = { title: "Review form check" };

export default async function CoachVideoPage({ params }: PageProps<"/coach/videos/[id]">) {
  const profile = await requireTrainer();
  const { id } = await params;
  const data = await loadSubmission(id);
  if (!data || data.submission.trainer_id !== profile.id) notFound();
  const client = data.people[data.submission.client_id];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/coach/videos" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Review queue
        </Link>
        <div className="flex gap-3 text-sm font-medium">
          <Link href={`/coach/videos?client=${data.submission.client_id}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
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
        isTrainer
        timezone={profile.timezone}
      />
    </div>
  );
}
