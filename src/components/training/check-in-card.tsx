import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import type { Tables } from "@/lib/supabase/database.types";
import { longDateLabel } from "@/lib/training/dates";
import type { Responder } from "@/lib/training/server";
import { CoachReply } from "./feedback";
import { RespondForm } from "./respond-form";

const METRICS: { key: keyof Tables<"check_ins">; label: string; invert?: boolean }[] = [
  { key: "sleep_quality", label: "Sleep" },
  { key: "energy_level", label: "Energy" },
  { key: "stress_level", label: "Stress", invert: true },
  { key: "nutrition_adherence", label: "Nutrition" },
  { key: "training_adherence", label: "Training" },
];

function tone(v: number, invert?: boolean) {
  const good = invert ? v <= 2 : v >= 4;
  const bad = invert ? v >= 4 : v <= 2;
  return good ? "green" : bad ? "red" : "amber";
}

/** A weekly check-in with its ratings, notes and the coach's reply (or a reply box). */
export function CheckInCard({
  checkIn,
  heading,
  respondAction,
  defaultOpen,
  weightUnit = "lb",
}: {
  checkIn: Tables<"check_ins"> & Responder;
  heading?: ReactNode;
  respondAction?: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultOpen?: boolean;
  weightUnit?: string;
}) {
  const notes: [string, string | null][] = [
    ["Wins", checkIn.wins],
    ["Struggles", checkIn.struggles],
    ["Questions", checkIn.questions],
  ];
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {heading}
          <p className="text-sm font-semibold">Week of {longDateLabel(checkIn.week_of, { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
        {checkIn.body_weight != null ? (
          <span className="text-sm font-semibold tabular-nums">
            {Number(checkIn.body_weight)} {weightUnit}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {METRICS.map(({ key, label, invert }) => {
          const v = checkIn[key] as number | null;
          return v != null ? (
            <Badge key={key} tone={tone(v, invert)}>
              {label} {v}/5
            </Badge>
          ) : null;
        })}
      </div>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {notes.map(([label, text]) =>
          text ? (
            <div key={label}>
              <dt className="text-xs font-semibold text-zinc-500">{label}</dt>
              <dd className="whitespace-pre-line text-zinc-800 dark:text-zinc-200">{text}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {checkIn.coach_response ? (
        <CoachReply className="mt-3" text={checkIn.coach_response} responder={checkIn.responder} at={checkIn.coach_responded_at} />
      ) : null}
      {respondAction ? (
        <div className="mt-3">
          <RespondForm action={respondAction} existing={checkIn.coach_response} defaultOpen={defaultOpen} placeholder="Thanks for checking in! This week let's focus on…" />
        </div>
      ) : null}
    </article>
  );
}
