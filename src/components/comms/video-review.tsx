"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Alert, Avatar, Badge, Button, Card, CardTitle, Textarea, cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatClock, markerPercent } from "@/lib/comms/policy";
import type { Person, VideoComment } from "@/lib/comms/types";
import { addVideoComment, deleteVideoComment, markVideoReviewed, reopenVideo } from "@/lib/comms/video-actions";

export function VideoReview({
  submission,
  videoUrl,
  initialComments,
  people,
  viewerId,
  isStaff,
  timezone,
  reviewedBy,
  reviewerControl,
}: {
  submission: { id: string; title: string; status: string; client_note: string | null; duration_seconds: number | null; created_at: string; exercise?: string | null };
  videoUrl: string | null;
  initialComments: VideoComment[];
  people: Record<string, Person>;
  viewerId: string;
  isStaff: boolean;
  timezone: string;
  /** Who marked it reviewed (shown on the card). */
  reviewedBy?: string | null;
  /** Staff: reviewer picker. */
  reviewerControl?: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState<VideoComment[]>(initialComments);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(submission.duration_seconds ?? 0);
  const [pinnedAt, setPinnedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const channel = supabase
      .channel(`video:${submission.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "video_comments", filter: `submission_id=eq.${submission.id}` },
        (payload) => {
          const c = payload.new as VideoComment;
          setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "video_comments" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) setComments((prev) => prev.filter((x) => x.id !== id));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, submission.id]);

  const sorted = useMemo(
    () =>
      [...comments].sort((a, b) => {
        const ta = a.timestamp_seconds ?? Number.POSITIVE_INFINITY;
        const tb = b.timestamp_seconds ?? Number.POSITIVE_INFINITY;
        return ta === tb ? a.created_at.localeCompare(b.created_at) : ta - tb;
      }),
    [comments],
  );
  const markers = sorted.filter((c) => c.timestamp_seconds !== null);

  function seek(seconds: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = seconds;
    v.pause();
    setCurrent(seconds);
    v.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function pinNow() {
    const v = video.current;
    const t = v ? v.currentTime : 0;
    v?.pause();
    setPinnedAt(Math.round(t * 10) / 10);
    input.current?.focus();
  }

  async function post(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    const id = crypto.randomUUID();
    const res = await addVideoComment({ id, submissionId: submission.id, body, timestampSeconds: pinnedAt });
    setPosting(false);
    if (!res.ok) return setError(res.error);
    setComments((prev) => (prev.some((x) => x.id === res.comment.id) ? prev : [...prev, res.comment]));
    setDraft("");
    setPinnedAt(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this comment?")) return;
    const before = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    const res = await deleteVideoComment({ id });
    if (!res.ok) {
      setComments(before);
      setError(res.error);
    }
  }

  function review(reopen = false) {
    startTransition(async () => {
      const res = reopen ? await reopenVideo({ id: submission.id }) : await markVideoReviewed({ id: submission.id });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const reviewed = submission.status === "reviewed";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <div className="overflow-hidden rounded-2xl bg-black">
          {videoUrl ? (
            <video
              ref={video}
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
              className="mx-auto max-h-[70dvh] w-full"
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
            />
          ) : (
            <p className="p-10 text-center text-sm text-zinc-300">This video is unavailable. It may have been removed.</p>
          )}
        </div>

        {/* Timeline with comment markers */}
        <div className="mt-3">
          <div
            className="relative h-3 cursor-pointer rounded-full bg-zinc-200 dark:bg-zinc-800"
            onClick={(e) => {
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - rect.left) / rect.width) * duration);
            }}
            aria-hidden="true"
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-brand/30" style={{ width: `${markerPercent(current, duration)}%` }} />
          </div>
          <div className="relative h-6">
            {duration
              ? markers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => seek(Number(c.timestamp_seconds))}
                    className={cn(
                      "absolute top-0 size-3 -translate-x-1/2 -translate-y-[9px] rounded-full border-2 border-white shadow dark:border-zinc-900",
                      c.author_id === viewerId ? "bg-brand" : "bg-sky-500",
                    )}
                    style={{ left: `${markerPercent(Number(c.timestamp_seconds), duration)}%` }}
                    title={`${formatClock(Number(c.timestamp_seconds))}: ${c.body.slice(0, 60)}`}
                    aria-label={`Jump to comment at ${formatClock(Number(c.timestamp_seconds))}`}
                  />
                ))
              : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              {formatClock(current)}
              {duration ? ` / ${formatClock(duration)}` : ""}
            </span>
            <span>{markers.length} timestamped note{markers.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        <Card className="mt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{submission.title}</CardTitle>
              <p className="mt-0.5 text-xs text-zinc-500">
                {submission.exercise ? `${submission.exercise} · ` : ""}
                Sent {formatInTimeZone(submission.created_at, timezone, "MMM d, h:mm a")}
              </p>
            </div>
            <Badge tone={reviewed ? "green" : "amber"}>{reviewed ? "Reviewed" : "Awaiting review"}</Badge>
          </div>
          {reviewed && reviewedBy ? <p className="mt-2 text-xs text-zinc-500">Reviewed by {reviewedBy}</p> : null}
          {submission.client_note ? (
            <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-zinc-950">“{submission.client_note}”</p>
          ) : null}
          {isStaff ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              {reviewerControl}
              {reviewed ? (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => review(true)}>
                  Move back to queue
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => review()}>
                  {pending ? "Saving…" : "Mark reviewed & notify client"}
                </Button>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        <Card className="p-4">
          <form onSubmit={post} className="grid gap-2">
            {error ? <Alert tone="red">{error}</Alert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={pinNow} disabled={!videoUrl}>
                ⏱ Comment at {formatClock(current)}
              </Button>
              {pinnedAt !== null ? (
                <Badge tone="brand">
                  At {formatClock(pinnedAt)}
                  <button type="button" className="ml-1.5 font-bold" onClick={() => setPinnedAt(null)} aria-label="Remove timestamp">
                    ✕
                  </button>
                </Badge>
              ) : (
                <span className="text-xs text-zinc-500">or leave a general comment</span>
              )}
            </div>
            <label htmlFor="video-comment" className="sr-only">
              Comment
            </label>
            <Textarea
              ref={input}
              id="video-comment"
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={isStaff ? "Coaching cue, e.g. ‘Brace before you unrack’" : "Reply or ask a question"}
              className="min-h-20"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
                {posting ? "Posting…" : isStaff ? "Add note" : "Reply"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Notes & replies</h2>
          <span className="text-xs text-zinc-500">{comments.length}</span>
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {isStaff ? "No notes yet. Pause on a rep and click “Comment at” to pin a cue to that moment." : "No feedback yet. Your coach's notes will appear here, pinned to moments in the video."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((c) => {
              const author = people[c.author_id];
              const near = c.timestamp_seconds !== null && Math.abs(Number(c.timestamp_seconds) - current) < 1.5;
              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-2xl border p-3 text-sm transition-colors",
                    near ? "border-brand bg-brand/5" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={author?.name} src={author?.avatarUrl} size={24} />
                    <span className="truncate font-medium">{author?.name ?? "Someone"}</span>
                    {c.timestamp_seconds !== null ? (
                      <button
                        type="button"
                        onClick={() => seek(Number(c.timestamp_seconds))}
                        className="ml-auto rounded-full bg-brand/10 px-2 py-0.5 font-mono text-xs font-semibold text-brand hover:bg-brand/20"
                        aria-label={`Jump to ${formatClock(Number(c.timestamp_seconds))}`}
                      >
                        {formatClock(Number(c.timestamp_seconds))}
                      </button>
                    ) : (
                      <span className="ml-auto text-xs text-zinc-400">General</span>
                    )}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap">{c.body}</p>
                  <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                    <span>{formatInTimeZone(c.created_at, timezone, "MMM d, h:mm a")}</span>
                    {c.author_id === viewerId ? (
                      <button type="button" onClick={() => remove(c.id)} className="hover:text-red-600">
                        Delete
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
