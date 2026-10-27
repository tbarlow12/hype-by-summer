import Link from "next/link";
import { Badge, buttonClass, cn, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime } from "@/lib/format";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/scheduling/labels";
import { addDays, localDateOf, startOfLocalDay, timeToMinutes, weekdayOf } from "@/lib/scheduling/tz";
import type { Tables } from "@/lib/supabase/database.types";

export const metadata = { title: "Calendar" };

type Booking = Tables<"bookings">;
type Block = { key: string; bookings: Booking[]; start: string; end: string };

const HOUR_PX = 48;

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export default async function CalendarPage({ searchParams }: PageProps<"/coach/calendar">) {
  const profile = await requireTrainer();
  const sp = await searchParams;
  const tz = profile.timezone;
  const view = sp.view === "list" ? "list" : "week";
  const showCancelled = sp.cancelled === "1";
  const today = localDateOf(new Date(), tz);
  const anchor = isDate(sp.date) ? sp.date : today;
  const weekStart = addDays(anchor, -((weekdayOf(anchor) + 6) % 7)); // Monday
  const rangeStart = view === "week" ? weekStart : anchor;
  const rangeEnd = view === "week" ? addDays(weekStart, 7) : addDays(anchor, 30);

  const supabase = await createClient();
  let query = supabase
    .from("bookings")
    .select("*")
    .eq("trainer_id", profile.id)
    .gte("starts_at", startOfLocalDay(rangeStart, tz).toISOString())
    .lt("starts_at", startOfLocalDay(rangeEnd, tz).toISOString())
    .order("starts_at");
  if (!showCancelled) query = query.not("status", "in", "(cancelled,late_cancelled)");
  const [{ data: bookingRows }, { data: types }] = await Promise.all([
    query.limit(1000),
    supabase.from("session_types").select("id, name, color, capacity").eq("trainer_id", profile.id),
  ]);
  const bookings = (bookingRows ?? []).filter((b) => b.cancel_reason !== "rescheduled" || showCancelled);
  const clientIds = [...new Set(bookings.map((b) => b.client_id).filter((x): x is string => Boolean(x)))];
  const { data: clients } = clientIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", clientIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const typeById = new Map((types ?? []).map((t) => [t.id, t]));
  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const who = (b: Booking) => (b.client_id ? displayName(clientById.get(b.client_id)) : (b.guest_name ?? b.guest_email ?? "Guest"));

  // Group bookings of the same session at the same start into one block.
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  for (const b of bookings) {
    const active = !["cancelled", "late_cancelled"].includes(b.status);
    const key = active ? `${b.session_type_id}|${b.starts_at}` : b.id;
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

  const nav = (date: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ view, date, ...(showCancelled ? { cancelled: "1" } : {}), ...extra });
    return `/coach/calendar?${p}`;
  };
  const step = view === "week" ? 7 : 30;

  const blockTitle = (b: Block) => {
    const st = typeById.get(b.bookings[0]!.session_type_id);
    return (st?.capacity ?? 1) > 1 ? `${st?.name ?? "Session"} (${b.bookings.length}/${st?.capacity})` : who(b.bookings[0]!);
  };

  const agenda = (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <EmptyState
          title={view === "week" ? "Nothing booked this week" : "Nothing booked in the next 30 days"}
          description="Share your booking link or book a client in yourself."
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
                  const st = typeById.get(first.session_type_id);
                  return (
                    <li key={b.key}>
                      <Link href={`/coach/calendar/${first.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <span className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: st?.color ?? "#e11d48" }} aria-hidden />
                        <span className="w-20 shrink-0 text-sm tabular-nums">
                          {formatDateTime(b.start, tz, "h:mm a")}
                          <span className="block text-xs text-zinc-500">{formatDateTime(b.end, tz, "h:mm a")}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{blockTitle(b)}</span>
                          <span className="block truncate text-xs text-zinc-500">{st?.name}</span>
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

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Times in ${tz.replace(/_/g, " ")}`}
        actions={
          <>
            <LinkButton href="/coach/calendar/new">Book a client</LinkButton>
            <LinkButton href="/coach/settings" variant="outline">
              Calendar feed
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={nav(addDays(anchor, -step))} className={buttonClass("outline", "sm")} aria-label="Previous">
            ‹
          </Link>
          <Link href={nav(today)} className={buttonClass("outline", "sm")}>
            Today
          </Link>
          <Link href={nav(addDays(anchor, step))} className={buttonClass("outline", "sm")} aria-label="Next">
            ›
          </Link>
          <span className="ml-2 text-sm font-semibold">
            {view === "week"
              ? `${formatDateTime(`${weekStart}T12:00:00Z`, "UTC", "MMM d")} – ${formatDateTime(`${addDays(weekStart, 6)}T12:00:00Z`, "UTC", "MMM d, yyyy")}`
              : `From ${formatDateTime(`${anchor}T12:00:00Z`, "UTC", "MMM d, yyyy")}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/coach/calendar?${new URLSearchParams({ view: "week", date: anchor, ...(showCancelled ? { cancelled: "1" } : {}) })}`} className={buttonClass(view === "week" ? "secondary" : "ghost", "sm")}>
            Week
          </Link>
          <Link href={`/coach/calendar?${new URLSearchParams({ view: "list", date: anchor, ...(showCancelled ? { cancelled: "1" } : {}) })}`} className={buttonClass(view === "list" ? "secondary" : "ghost", "sm")}>
            Agenda
          </Link>
          <Link
            href={`/coach/calendar?${new URLSearchParams({ view, date: anchor, ...(showCancelled ? {} : { cancelled: "1" }) })}`}
            className={buttonClass("ghost", "sm")}
          >
            {showCancelled ? "Hide cancelled" : "Show cancelled"}
          </Link>
        </div>
      </div>

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
              {days.map((d) => (
                <div key={d} className="relative border-l border-zinc-200 dark:border-zinc-800" style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800" style={{ top: i * HOUR_PX }} />
                  ))}
                  {blocks
                    .filter((b) => localDateOf(b.start, tz) === d)
                    .map((b) => {
                      const first = b.bookings[0]!;
                      const st = typeById.get(first.session_type_id);
                      const startMin = minutesOf(b.start);
                      const endMin = localDateOf(b.end, tz) === d ? minutesOf(b.end) : 24 * 60;
                      const top = ((startMin - firstHour * 60) / 60) * HOUR_PX;
                      const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_PX - 2);
                      const inactive = ["cancelled", "late_cancelled"].includes(first.status);
                      return (
                        <Link
                          key={b.key}
                          href={`/coach/calendar/${first.id}`}
                          className={cn(
                            "absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-[11px] leading-tight shadow-sm hover:z-10 hover:shadow",
                            inactive ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800" : "bg-white dark:bg-zinc-950",
                            first.status === "pending_payment" && "border-dashed opacity-80",
                          )}
                          style={{ top, height, borderLeftColor: st?.color ?? "#e11d48" }}
                          title={`${blockTitle(b)} · ${STATUS_LABELS[first.status]}`}
                        >
                          <span className="block font-semibold">{formatDateTime(b.start, tz, "h:mm")} {blockTitle(b)}</span>
                          <span className="block truncate text-zinc-500">{st?.name}</span>
                          {first.status !== "confirmed" ? <span className="block">{STATUS_LABELS[first.status]}</span> : null}
                        </Link>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
