// Server-safe display pieces for the coach/client feedback loop.
import type { ReactNode } from "react";
import { Badge, cn } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import type { Tables } from "@/lib/supabase/database.types";
import { DIFFICULTY_LABELS, type FeedbackFlag, type WeekAdherence } from "@/lib/training/adherence";
import { longDateLabel } from "@/lib/training/dates";
import type { LogWithSets, Responder } from "@/lib/training/server";
import { titleCase } from "@/lib/format";
import { RespondForm } from "./respond-form";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function AdherenceBars({ weeks, currentWeek }: { weeks: WeekAdherence[]; currentWeek: number | null }) {
  if (!weeks.length) return <p className="text-sm text-zinc-500">No weeks yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {weeks.map((w) => {
        const future = currentWeek != null && w.week > currentWeek;
        return (
          <li key={w.week} className="grid grid-cols-[64px_1fr_72px] items-center gap-2 text-xs">
            <span className={cn("font-medium", w.week === currentWeek ? "text-brand" : "text-zinc-500")}>Week {w.week}</span>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-label={`Week ${w.week} adherence`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.pct ?? 0}>
              <div
                className={cn("h-full rounded-full", (w.pct ?? 0) >= 80 ? "bg-emerald-500" : (w.pct ?? 0) >= 50 ? "bg-amber-500" : "bg-brand")}
                style={{ width: `${w.pct ?? 0}%` }}
              />
            </div>
            <span className="text-right tabular-nums text-zinc-500">
              {w.prescribed ? (future ? `0/${w.prescribed}` : `${w.completed}/${w.prescribed} · ${w.pct}%`) : "Rest"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function FlagBadges({ flags }: { flags: FeedbackFlag[] }) {
  if (!flags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <Badge key={f.kind} tone={f.kind === "pain" ? "red" : f.kind === "too_easy" ? "blue" : "amber"}>
          {f.label}
        </Badge>
      ))}
    </div>
  );
}

/** The coach's reply, labelled with whoever on the team wrote it. */
export function CoachReply({
  text,
  responder,
  at,
  className = "mt-2",
}: {
  text: string;
  responder?: Responder["responder"];
  at?: string | null;
  className?: string;
}) {
  const name = responder?.full_name?.trim();
  return (
    <div className={cn(className, "rounded-lg bg-brand/5 px-3 py-2 text-sm")}>
      <p className="text-xs font-semibold text-brand">
        {name ? `${name} (coach)` : "Coach"}
        {at ? <span className="ml-1 font-normal text-zinc-500">· {longDateLabel(at.slice(0, 10), { month: "short", day: "numeric" })}</span> : null}
      </p>
      <p className="whitespace-pre-line text-zinc-800 dark:text-zinc-200">{text}</p>
    </div>
  );
}

function Rating({ label, value, max = 5 }: { label: string; value: ReactNode; max?: number }) {
  return (
    <span className="text-xs text-zinc-500">
      {label} <span className="font-semibold text-zinc-800 dark:text-zinc-200">{value}</span>
      {typeof value === "number" ? `/${max}` : ""}
    </span>
  );
}

function setsSummary(sets: LogWithSets["sets"]) {
  const groups = new Map<string, { name: string; parts: string[] }>();
  for (const s of sets) {
    const g = groups.get(s.exercise_id) ?? { name: s.exercise_name, parts: [] };
    if (!s.completed) g.parts.push("skipped");
    else if (s.weight != null && s.reps != null) g.parts.push(`${s.weight}${s.weight_unit}×${s.reps}`);
    else if (s.reps != null) g.parts.push(`${s.reps} reps`);
    else if (s.duration_seconds != null) g.parts.push(`${s.duration_seconds}s`);
    else g.parts.push("done");
    groups.set(s.exercise_id, g);
  }
  return [...groups.values()];
}

/** One logged workout: ratings, flags, sets, client feedback and the coach's reply. */
export function WorkoutLogItem({
  log,
  respondAction,
  showSets = true,
  clientName,
}: {
  log: LogWithSets;
  respondAction?: Action;
  showSets?: boolean;
  clientName?: string;
}) {
  const summary = setsSummary(log.sets);
  return (
    <article id={`log-${log.id}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {log.workout ? log.workout.name : "Freestyle workout"}
            {log.workout ? <span className="ml-1 font-normal text-zinc-500">· W{log.workout.week} D{log.workout.day}</span> : null}
          </p>
          <p className="text-xs text-zinc-500">
            {clientName ? `${clientName} · ` : ""}
            {longDateLabel(log.performed_on, { weekday: "short", month: "short", day: "numeric" })}
            {log.duration_minutes ? ` · ${log.duration_minutes} min` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {log.pain_flag ? <Badge tone="red">Pain</Badge> : null}
          {log.difficulty_rating ? (
            <Badge tone={log.difficulty_rating >= 4 ? "amber" : log.difficulty_rating <= 2 ? "blue" : "green"}>
              {DIFFICULTY_LABELS[log.difficulty_rating]}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {log.session_rpe != null ? <Rating label="RPE" value={Number(log.session_rpe)} max={10} /> : null}
        {log.enjoyment_rating != null ? <Rating label="Enjoyment" value={log.enjoyment_rating} /> : null}
        {log.energy_level != null ? <Rating label="Energy" value={log.energy_level} /> : null}
      </div>
      {showSets && summary.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {summary.map((g) => (
            <li key={g.name}>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{g.name}:</span> {g.parts.join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {log.feedback ? (
        <blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-sm whitespace-pre-line text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          {log.feedback}
        </blockquote>
      ) : null}
      {log.coach_response ? <CoachReply text={log.coach_response} responder={log.responder} at={log.coach_responded_at} /> : null}
      {respondAction ? (
        <div className="mt-2">
          <RespondForm action={respondAction} existing={log.coach_response} placeholder="Great work! Next time try…" />
        </div>
      ) : null}
    </article>
  );
}

export function ProgramFeedbackItem({ fb, respondAction }: { fb: Tables<"program_feedback"> & Responder; respondAction?: Action }) {
  return (
    <article className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {fb.week ? `Week ${fb.week} feedback` : "Program feedback"}
          <span className="ml-2 text-xs font-normal text-zinc-500">{longDateLabel(fb.created_at.slice(0, 10))}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {fb.overall_rating ? <Badge tone="brand">{fb.overall_rating}/5 overall</Badge> : null}
          {fb.difficulty ? <Badge tone={fb.difficulty === "just_right" ? "green" : "amber"}>{titleCase(fb.difficulty)}</Badge> : null}
          {fb.volume ? <Badge tone={fb.volume === "just_right" ? "green" : "amber"}>Volume: {titleCase(fb.volume)}</Badge> : null}
        </div>
      </div>
      <dl className="mt-2 grid gap-1 text-sm">
        {fb.favorite_parts ? (
          <div>
            <dt className="inline text-xs font-semibold text-zinc-500">Loved: </dt>
            <dd className="inline whitespace-pre-line">{fb.favorite_parts}</dd>
          </div>
        ) : null}
        {fb.least_favorite_parts ? (
          <div>
            <dt className="inline text-xs font-semibold text-zinc-500">Least favorite: </dt>
            <dd className="inline whitespace-pre-line">{fb.least_favorite_parts}</dd>
          </div>
        ) : null}
        {fb.requested_changes ? (
          <div>
            <dt className="inline text-xs font-semibold text-zinc-500">Would change: </dt>
            <dd className="inline whitespace-pre-line">{fb.requested_changes}</dd>
          </div>
        ) : null}
      </dl>
      {fb.coach_response ? <CoachReply text={fb.coach_response} responder={fb.responder} at={fb.coach_responded_at} /> : null}
      {respondAction ? (
        <div className="mt-2">
          <RespondForm action={respondAction} existing={fb.coach_response} placeholder="Thanks! Here's what I'll adjust…" />
        </div>
      ) : null}
    </article>
  );
}
