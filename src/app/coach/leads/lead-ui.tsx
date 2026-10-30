import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Badge, cn } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { optionLabel, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES, type LeadSource, type LeadStatus } from "@/lib/leads/options";
import { scoreTier } from "@/lib/leads/score";
import type { Tables } from "@/lib/supabase/database.types";

export type LeadRow = Tables<"leads">;

export function leadName(lead: Pick<LeadRow, "first_name" | "last_name" | "email">): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
}

export function StatusBadge({ status }: { status: string }) {
  const s = status as LeadStatus;
  return <Badge tone={STATUS_TONES[s] ?? "neutral"}>{STATUS_LABELS[s] ?? status}</Badge>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tier = scoreTier(score);
  return (
    <span
      title={`Lead score ${score}/100`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
        tier === "hot" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
        tier === "warm" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        tier === "cold" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      )}
    >
      {tier === "hot" ? "🔥" : null}
      {score}
    </span>
  );
}

export function sourceLabel(source: string | null): string {
  return source ? (SOURCE_LABELS[source as LeadSource] ?? optionLabel(source)) : "Unknown";
}

/** Request-time clock (server components render once per request). */
export const isPast = (iso: string) => new Date(iso).getTime() < Date.now();

export function FollowUp({ at, timeZone }: { at: string | null; timeZone: string }) {
  if (!at) return null;
  const overdue = isPast(at);
  return (
    <span className={cn("text-xs font-medium", overdue ? "text-red-600 dark:text-red-400" : "text-zinc-500")}>
      {overdue ? "Overdue: " : "Follow up "}
      {formatDateTime(at, timeZone, "MMM d, h:mm a")}
    </span>
  );
}

/** Compact card used in the board columns and the mobile list. */
export function LeadCard({
  lead,
  timeZone,
  magnetTitle,
  assignee,
  footer,
}: {
  lead: LeadRow;
  timeZone: string;
  magnetTitle?: string;
  /** Who the lead is assigned to (shown in team views). */
  assignee?: string | null;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/coach/leads/${lead.id}`} className="min-w-0 font-semibold hover:text-brand">
          <span className="block truncate">{leadName(lead)}</span>
          {lead.first_name ? <span className="block truncate text-xs font-normal text-zinc-500">{lead.email}</span> : null}
        </Link>
        <ScoreBadge score={lead.score} />
      </div>
      <p className="mt-2 truncate text-xs text-zinc-500">
        {magnetTitle ?? sourceLabel(lead.source)}
        {lead.utm_source ? ` · ${lead.utm_source}` : ""}
        {lead.primary_goal ? ` · ${optionLabel(lead.primary_goal)}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <FollowUp at={lead.next_follow_up_at} timeZone={timeZone} />
        {assignee !== undefined ? (
          <span className={cn("text-xs font-medium", assignee ? "text-zinc-600 dark:text-zinc-300" : "text-amber-600 dark:text-amber-400")}>
            {assignee ?? "Unassigned"}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-zinc-400">{formatDistanceToNowStrict(new Date(lead.created_at), { addSuffix: true })}</span>
      </div>
      {footer}
    </div>
  );
}
