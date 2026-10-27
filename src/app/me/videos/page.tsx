import Link from "next/link";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { VideoUploadForm } from "@/components/comms/video-upload-form";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { formatClock } from "@/lib/comms/policy";

export const metadata = { title: "Form checks" };

export default async function ClientVideosPage() {
  const profile = await requireClient();
  const trainerId = await getClientTrainerId(profile.id);
  const supabase = await createClient();
  const [{ data: exercises }, { data: subs }] = await Promise.all([
    supabase.from("exercises").select("id, name").order("name").limit(1000),
    supabase
      .from("video_submissions")
      .select("id, title, status, created_at, reviewed_at, duration_seconds, exercises(name), video_comments(count)")
      .eq("client_id", profile.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <PageHeader title="Form checks" description="Film a set, send it over, and get coaching notes pinned to the exact moment in your video." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardTitle className="mb-4">Send a new video</CardTitle>
          {trainerId ? (
            <VideoUploadForm exercises={exercises ?? []} />
          ) : (
            <p className="text-sm text-zinc-500">You&apos;ll be able to send form checks once you&apos;re connected with a coach.</p>
          )}
        </Card>
        <div>
          <h2 className="mb-3 text-sm font-semibold">Your videos</h2>
          {!subs?.length ? (
            <EmptyState title="No form checks yet" description="Your uploads and your coach's feedback will show up here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {subs.map((s) => {
                const comments = s.video_comments?.[0]?.count ?? 0;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/me/videos/${s.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-brand/40 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white" aria-hidden="true">
                        ▶
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{s.title}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {[s.exercises?.name, formatDate(s.created_at, profile.timezone, "MMM d"), s.duration_seconds ? formatClock(Number(s.duration_seconds)) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={s.status === "reviewed" ? "green" : "amber"}>{s.status === "reviewed" ? "Feedback ready" : "Awaiting review"}</Badge>
                        {comments ? <span className="text-xs text-zinc-500">{comments} note{comments === 1 ? "" : "s"}</span> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
