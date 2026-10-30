import Link from "next/link";
import { Badge, buttonClass, cn, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/scheduling/copy-button";
import { isManager, requireStaff } from "@/lib/auth";
import { businessUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName, formatDateTime } from "@/lib/format";
import { listCoaches } from "@/lib/scheduling/availability";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/scheduling/labels";
import { coachColor } from "@/lib/scheduling/staff";
import { addDays, localDateOf, startOfLocalDay, timeToMinutes, weekdayOf } from "@/lib/scheduling/tz";
import type { Tables } from "@/lib/supabase/database.types";

export const metadata = { title: "Calendar" };

type Booking = Tables<"bookings">;
type Block = { key: string; bookings: Booking[]; start: string; end: string };

const HOUR_PX = 48;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Week / agenda calendar. Coaches see their own sessions by default with a
 * toggle for the whole team; managers see the team, filterable by coach,
 * with a color per coach.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/coach/calendar">) {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const sp = await searchParams;
  const tz = profile.timezone;
  const view = sp.view === "list" ? "list" : "week";
  const showCancelled = sp.cancelled === "1";
  const scope: "mine" | "team" = sp.scope === "mine" || sp.scope === "team" ? sp.scope : manager ? "team" : "mine";
  const coachFilter = scope === "team" && typeof sp.coach === "string" && UUID.test(sp.coach) ? sp.coach : null;
  const today = localDateOf(new Date(), tz);
  const anchor = isDate(sp.date) ? sp.date : today;
  const weekStart = addDays(anchor, -((weekdayOf(anchor) + 6) % 7)); // Monday
  const rangeStart = view === "week" ? weekStart : anchor;
  const rangeEnd = view === "week" ? addDays(weekStart, 7) : addDays(anchor, 30);

  const supabase = await createClient();
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("business_id", business.id)
    .gte("starts_at", startOfLocalDay(rangeStart, tz).toISOString())
    .lt("starts_at", startOfLocalDay(rangeEnd, tz).toISOString())
    .order("starts_at");
  if (scope === "mine") query = query.eq("coach_id", profile.id);
  else if (coachFilter) query = query.eq("coach_id", coachFilter);
  if (!showCancelled) query = query.not("status", "in", "(cancelled,late_cancelled)");
  const [{ data: bookingRows }, { data: types }, coaches, { data: me }] = await Promise.all([
    query.limit(1000),
    supabase.from("session_types").select("id, name, color, capacity").eq("business_id", business.id),
    listCoaches(business.id),
    // The feed token isn't readable through RLS; read only the caller's own.
    createAdminClient().from("business_members").select("calendar_feed_token").eq("business_id", business.id).eq("user_id", profile.id).maybeSingle(),
  ]);
  const bookings = (bookingRows ?? []).filter((b) => b.cancel_reason !== "rescheduled" || showCancelled);
  const clientIds = [...new Set(bookings.map((b) => b.client_id).filter((x): x is string => Boolean(x)))];
  const { data: clients } = clientIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", clientIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const typeById = new Map((types ?? []).map((t) => [t.id, t]));
  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const who = (b: Booking) => (b.client_id ? displayName(clientById.get(b.client_id)) : (b.guest_name ?? b.guest_email ?? "Guest"));

  // Coaches shown in the legend/filter: bookable staff plus anyone with a booking in range.
  const team = coaches.filter((c) => c.isBookable || bookings.some((b) => b.coach_id === c.id));
  const colorOf = new Map(team.map((c, i) => [c.id, coachColor(i)]));
  const nameOf = new Map(coaches.map((c) => [c.id, c.name]));
  const teamView = scope === "team" && team.length > 1;
  const accent = (b: Booking) => (teamView ? (colorOf.get(b.coach_id) ?? "#71717a") : (typeById.get(b.session_type_id)?.color ?? "#e11d48"));

  // Group bookings of the same session (type + coach + start) into one block.
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  for (const b of bookings) {
    const active = !["cancelled", "late_cancelled"].includes(b.status);
    const key = active ? `${b.session_type_id}|${b.coach_id}|${b.starts_at}` : b.id;
    const existing = byKey.get(key);
    if (existing) existing.bookings.push(b);
    else {
      const block = { key, bookings: [b], start: b.starts_at, end: b.ends_at };
      byKey.set(key, block);
      blocks.push(block);
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const minutesOf = (iso: string) => timeToMinutes(formatDateTime(iso, tz, "HH:mm"));
  const firstHour = Math.min(6, ...blocks.map((b) => Math.floor(minutesOf(b.start) / 60)));
  const lastHour = Math.max(21, ...blocks.map((b) => Math.ceil((minutesOf(b.end) || 1440) / 60)));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  const params = (over: Record<string, string | null>) => {
    const base: Record<string, string | null> = {
      view,
      date: anchor,
      cancelled: showCancelled ? "1" : null,
      scope,
      coach: coachFilter,
      ...over,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/coach/calendar?${p}`;
  };
  const step = view === "week" ? 7 : 30;

  const blockTitle = (b: Block) => {
    const st = typeById.get(b.bookings[0]!.session_type_id);
    return (st?.capacity ?? 1) > 1 ? `${st?.name ?? "Session"} (${b.bookings.length}/${st?.capacity})` : who(b.bookings[0]!);
  };
  const blockSub = (b: Block) => {
    const first = b.bookings[0]!;
    const st = typeById.get(first.session_type_id);
    return teamView ? `${st?.name ?? ""} · ${nameOf.get(first.coach_id) ?? "Coach"}` : (st?.name ?? "");
  };

  const agenda = (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <EmptyState
          title={view === "week" ? "Nothing booked this week" : "Nothing booked in the next 30 days"}
          description="Share the booking page or book a client in yourself."
          action={<LinkButton href="/coach/calendar/new">Book a client</LinkButton>}
        />
      ) : (
        [...new Set(blocks.map((b) => localDateOf(b.start, tz)))].map((date) => (
          <section key={date}>
            <h2 className={cn("mb-2 text-sm font-semibold", date === today ? "text-brand" : "text-zinc-500")}>
              {formatDateTime(`${date}T12:00:00Z`, "UTC", "EEEE, MMMM d")}
              {date === today ? " · Today" : ""}
            </h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {blocks
                .filter((b) => localDateOf(b.start, tz) === date)
                .map((b) => {
                  const first = b.bookings[0]!;
                  return (
                    <li key={b.key}>
                      <Link href={`/coach/calendar/${first.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent(first) }} aria-hidden />
                        <span className="w-20 shrink-0 text-sm tabular-nums">
                          {formatDateTime(b.start, tz, "h:mm a")}
                          <span className="block text-xs text-zinc-500">{formatDateTime(b.end, tz, "h:mm a")}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{blockTitle(b)}</span>
                          <span className="block truncate text-xs text-zinc-500">{blockSub(b)}</span>
                        </span>
                        <Badge tone={STATUS_TONES[first.status]}>{STATUS_LABELS[first.status]}</Badge>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}
    </div>
  );

  const feedUrl = me ? businessUrl(business, `/api/calendar/${me.calendar_feed_token}.ics`) : null;

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Times in ${tz.replace(/_/g, " ")}`}
        actions={
          <>
            <LinkButton href="/coach/calendar/new">Book a client</LinkButton>
            {feedUrl ? (
              <details className="relative">
                <summary className={buttonClass("outline", "md", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>Calendar feed</summary>
                <div className="absolute right-0 z-20 mt-2 flex w-80 flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                  <p>Subscribe to your sessions in Google, Apple or Outlook Calendar. Keep this link private.</p>
                  <code className="block break-all rounded-lg bg-zinc-100 p-2 text-xs dark:bg-zinc-800">{feedUrl}</code>
                  <CopyButton text={feedUrl} />
                </div>
              </details>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={params({ date: addDays(anchor, -step) })} className={buttonClass("outline", "sm")} aria-label="Previous">
            ‹
          </Link>
          <Link href={params({ date: today })} className={buttonClass("outline", "sm")}>
            Today
          </Link>
          <Link href={params({ date: addDays(anchor, step) })} className={buttonClass("outline", "sm")} aria-label="Next">
            ›
          </Link>
          <span className="ml-2 text-sm font-semibold">
            {view === "week"
              ? `${formatDateTime(`${weekStart}T12:00:00Z`, "UTC", "MMM d")} – ${formatDateTime(`${addDays(weekStart, 6)}T12:00:00Z`, "UTC", "MMM d, yyyy")}`
              : `From ${formatDateTime(`${anchor}T12:00:00Z`, "UTC", "MMM d, yyyy")}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {team.length > 1 ? (
            <span className="mr-2 inline-flex rounded-full border border-zinc-200 p-0.5 dark:border-zinc-800" role="group" aria-label="Whose sessions">
              <Link href={params({ scope: "mine", coach: null })} aria-current={scope === "mine" ? "true" : undefined} className={buttonClass(scope === "mine" ? "secondary" : "ghost", "sm")}>
                Mine
              </Link>
              <Link href={params({ scope: "team", coach: null })} aria-current={scope === "team" ? "true" : undefined} className={buttonClass(scope === "team" ? "secondary" : "ghost", "sm")}>
                Team
              </Link>
            </span>
          ) : null}
          <Link href={params({ view: "week" })} className={buttonClass(view === "week" ? "secondary" : "ghost", "sm")}>
            Week
          </Link>
          <Link href={params({ view: "list" })} className={buttonClass(view === "list" ? "secondary" : "ghost", "sm")}>
            Agenda
          </Link>
          <Link href={params({ cancelled: showCancelled ? null : "1" })} className={buttonClass("ghost", "sm")}>
            {showCancelled ? "Hide cancelled" : "Show cancelled"}
          </Link>
        </div>
      </div>

      {scope === "team" && team.length > 1 ? (
        <nav aria-label="Filter by coach" className="mb-4 flex flex-wrap gap-2">
          <Link
            href={params({ coach: null })}
            aria-current={!coachFilter ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              !coachFilter ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-200 dark:border-zinc-800",
            )}
          >
            All coaches
          </Link>
          {team.map((c) => (
            <Link
              key={c.id}
              href={params({ coach: coachFilter === c.id ? null : c.id })}
              aria-current={coachFilter === c.id ? "true" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                coachFilter === c.id ? "border-zinc-900 dark:border-white" : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: colorOf.get(c.id) }} aria-hidden />
              {c.id === profile.id ? `${c.name} (you)` : c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {view === "list" ? (
        agenda
      ) : (
        <>
          <div className="md:hidden">{agenda}</div>
          <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid min-w-[760px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
              <div className="border-b border-zinc-200 dark:border-zinc-800" />
              {days.map((d) => (
                <div
                  key={d}
                  className={cn(
                    "border-b border-l border-zinc-200 px-2 py-2 text-center text-xs font-semibold dark:border-zinc-800",
                    d === today ? "text-brand" : "text-zinc-500",
                  )}
                >
                  {formatDateTime(`${d}T12:00:00Z`, "UTC", "EEE d")}
                </div>
              ))}
              <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, i) => (
                  <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-zinc-400" style={{ top: i * HOUR_PX }}>
                    {i === 0 ? "" : formatDateTime(`2000-01-01T${String(h).padStart(2, "0")}:00:00Z`, "UTC", "h a")}
                  </span>
                ))}
              </div>
              {days.map((d) => {
                const dayBlocks = blocks.filter((b) => localDateOf(b.start, tz) === d);
                return (
                  <div key={d} className="relative border-l border-zinc-200 dark:border-zinc-800" style={{ height: hours.length * HOUR_PX }}>
                    {hours.map((h, i) => (
                      <div key={h} className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800" style={{ top: i * HOUR_PX }} />
                    ))}
                    {dayBlocks.map((b) => {
                      const first = b.bookings[0]!;
                      const startMin = minutesOf(b.start);
                      const endMin = localDateOf(b.end, tz) === d ? minutesOf(b.end) : 24 * 60;
                      const top = ((startMin - firstHour * 60) / 60) * HOUR_PX;
                      const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_PX - 2);
                      const inactive = ["cancelled", "late_cancelled"].includes(first.status);
                      // Side-by-side columns for overlapping sessions (team view).
                      const overlapping = dayBlocks.filter((o) => o.start < b.end && o.end > b.start);
                      const col = overlapping.indexOf(b);
                      const width = 100 / overlapping.length;
                      return (
                        <Link
                          key={b.key}
                          href={`/coach/calendar/${first.id}`}
                          className={cn(
                            "absolute overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-[11px] leading-tight shadow-sm hover:z-10 hover:shadow",
                            inactive ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800" : "bg-white dark:bg-zinc-950",
                            first.status === "pending_payment" && "border-dashed opacity-80",
                          )}
                          style={{
                            top,
                            height,
                            left: `calc(${col * width}% + 2px)`,
                            width: `calc(${width}% - 4px)`,
                            borderLeftColor: accent(first),
                          }}
                          title={`${blockTitle(b)} · ${blockSub(b)} · ${STATUS_LABELS[first.status]}`}
                        >
                          <span className="block font-semibold">{formatDateTime(b.start, tz, "h:mm")} {blockTitle(b)}</span>
                          <span className="block truncate text-zinc-500">{blockSub(b)}</span>
                          {first.status !== "confirmed" ? <span className="block">{STATUS_LABELS[first.status]}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
