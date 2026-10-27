"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, buttonClass, cn } from "@/components/ui";
import { isEmbeddableRoom, sessionClock } from "@/lib/comms/policy";
import { createRoomForBooking } from "./actions";

export type TodayWorkout = {
  program: string;
  week: number;
  day: number;
  name: string | null;
  notes: string | null;
  minutes: number | null;
  exercises: { id: string; name: string; group: string | null; prescription: string; notes: string | null }[];
};

function embedUrl(url: string, displayName: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "meet.jit.si" || u.hostname.endsWith(".jitsi.net")) {
      u.hash = `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}&config.prejoinConfig.enabled=true`;
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function LiveRoom({
  bookingId,
  isTrainer,
  viewerName,
  title,
  when,
  startsAt,
  endsAt,
  roomUrl,
  cancelled,
  isVirtual,
  backHref,
  chatHref,
  workout,
}: {
  bookingId: string;
  isTrainer: boolean;
  viewerName: string;
  title: string;
  when: string;
  startsAt: string;
  endsAt: string;
  roomUrl: string | null;
  cancelled: boolean;
  isVirtual: boolean;
  backHref: string;
  chatHref: string | null;
  /** undefined = not shown (client view or guest); null = no workout scheduled. */
  workout?: TodayWorkout | null;
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [showWorkout, setShowWorkout] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = now ? sessionClock(startsAt, endsAt, now) : null;
  const embeddable = isEmbeddableRoom(roomUrl);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <Link href={backHref} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="Leave session page">
          <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.7 4.3a1 1 0 010 1.4L8.4 10l4.3 4.3a1 1 0 01-1.4 1.4l-5-5a1 1 0 010-1.4l5-5a1 1 0 011.4 0z" clipRule="evenodd" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{title}</h1>
          <p className="truncate text-xs text-zinc-400">{when}</p>
        </div>
        {clock ? (
          <span
            className={cn(
              "rounded-full px-3 py-1 font-mono text-xs font-semibold tabular-nums",
              clock.phase === "live" ? "bg-emerald-500/15 text-emerald-300" : clock.phase === "before" ? "bg-sky-500/15 text-sky-300" : "bg-zinc-800 text-zinc-400",
            )}
            aria-live="off"
          >
            {clock.phase === "live" ? "● " : ""}
            {clock.label}
          </span>
        ) : null}
        <div className="flex gap-2">
          {chatHref ? (
            <Link href={chatHref} className={buttonClass("ghost", "sm", "text-zinc-300 hover:bg-zinc-800 hover:text-white")}>
              Chat
            </Link>
          ) : null}
          {workout !== undefined ? (
            <Button variant="ghost" size="sm" className="hidden text-zinc-300 hover:bg-zinc-800 hover:text-white lg:inline-flex" onClick={() => setShowWorkout((s) => !s)} aria-pressed={showWorkout}>
              {showWorkout ? "Hide workout" : "Show workout"}
            </Button>
          ) : null}
          {roomUrl ? (
            <a href={roomUrl} target="_blank" rel="noreferrer" className={buttonClass("outline", "sm", "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800")}>
              Open in new tab ↗
            </a>
          ) : null}
        </div>
      </header>

      {cancelled ? (
        <div className="p-4">
          <Alert tone="amber">This session was cancelled. The room link is no longer in use.</Alert>
        </div>
      ) : null}
      {!isVirtual && !cancelled ? (
        <div className="px-4 pt-4">
          <Alert tone="neutral">Heads up: this session is booked as in person. You can still meet here if plans changed.</Alert>
        </div>
      ) : null}

      <div className={cn("grid flex-1 gap-0", workout !== undefined && showWorkout && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        <div className="flex min-h-[60dvh] flex-col">
          {roomUrl && embeddable ? (
            <iframe
              src={embedUrl(roomUrl, viewerName)}
              title="Video session"
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              allowFullScreen
              className="w-full flex-1 border-0 bg-black"
            />
          ) : roomUrl ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-zinc-300">This room opens in its own window.</p>
              <a href={roomUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "lg")}>
                Join the call
              </a>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              {error ? <Alert tone="red">{error}</Alert> : null}
              {isTrainer ? (
                <>
                  <p className="text-zinc-300">There&apos;s no video room for this session yet.</p>
                  <Button
                    size="lg"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await createRoomForBooking({ bookingId });
                        if (!res.ok) setError(res.error);
                        else router.refresh();
                      })
                    }
                  >
                    {pending ? "Creating room…" : "Create video room"}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-zinc-300">Your coach hasn&apos;t opened the video room yet.</p>
                  <Button variant="outline" onClick={() => router.refresh()} className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800">
                    Check again
                  </Button>
                </>
              )}
            </div>
          )}
          <p className="px-4 py-2 text-center text-[11px] text-zinc-500">
            Allow camera and microphone access when your browser asks. Trouble connecting? Use &ldquo;Open in new tab&rdquo;.
          </p>
        </div>

        {workout !== undefined && showWorkout ? (
          <aside className="border-t border-zinc-800 bg-zinc-900 p-4 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Client&apos;s workout today</h2>
            {!workout ? (
              <p className="mt-3 text-sm text-zinc-400">No programmed workout for this day. Coach freestyle or check their plan.</p>
            ) : (
              <div className="mt-2">
                <p className="text-lg font-semibold">{workout.name ?? "Rest / no workout scheduled"}</p>
                <p className="text-xs text-zinc-400">
                  {workout.program} · Week {workout.week}, day {workout.day}
                  {workout.minutes ? ` · ~${workout.minutes} min` : ""}
                </p>
                {workout.notes ? <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-300">{workout.notes}</p> : null}
                {workout.exercises.length ? (
                  <ol className="mt-4 flex flex-col gap-2">
                    {workout.exercises.map((e, i) => (
                      <li key={e.id} className="rounded-xl bg-zinc-950 p-3">
                        <p className="text-sm font-semibold">
                          <span className="mr-2 text-zinc-500">{e.group ?? i + 1}</span>
                          {e.name}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-400">{e.prescription}</p>
                        {e.notes ? <p className="mt-1 text-xs text-zinc-300">{e.notes}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : workout.name ? (
                  <p className="mt-3 text-sm text-zinc-400">No exercises listed for this workout.</p>
                ) : null}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
