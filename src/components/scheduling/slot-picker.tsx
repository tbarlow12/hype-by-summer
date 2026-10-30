"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { cn, Select } from "@/components/ui";
import { addDays, parseDate, weekdayOf } from "@/lib/scheduling/tz";
import type { TeamSlot, TeamSlotDay } from "@/lib/scheduling/slots";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
const subscribe = () => () => {};

/** Viewer's browser timezone (server render falls back to `fallback`). */
export function useBrowserTimezone(fallback: string): string {
  return useSyncExternalStore(subscribe, browserTz, () => fallback);
}

function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type State = { key: string; days: TeamSlotDay[]; error?: string };

export function SlotPicker({
  sessionSlug,
  coach = "any",
  fallbackTimezone,
  initialMonth,
  minMonth,
  selected,
  onSelect,
  rescheduleToken,
  showFull = false,
}: {
  sessionSlug: string;
  /** "any" or a coach id. */
  coach?: string;
  /** Used for server render and when the browser zone is unknown. */
  fallbackTimezone: string;
  /** "yyyy-MM" to open on. */
  initialMonth: string;
  /** Earliest month the viewer can navigate back to (default: initialMonth). */
  minMonth?: string;
  selected: TeamSlot | null;
  onSelect: (slot: TeamSlot | null, timezone: string) => void;
  rescheduleToken?: string;
  /** Show full group slots (to offer the waitlist). */
  showFull?: boolean;
}) {
  const detected = useBrowserTimezone(fallbackTimezone);
  const [tzOverride, setTzOverride] = useState<string | null>(null);
  const tz = tzOverride ?? detected;
  const [month, setMonth] = useState(initialMonth);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const timezones = useMemo(() => allTimezones(), []);

  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const key = `${sessionSlug}|${coach}|${from}|${tz}|${rescheduleToken ?? ""}`;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ session: sessionSlug, coach, from, to, tz });
    if (rescheduleToken) params.set("reschedule", rescheduleToken);
    fetch(`/api/availability?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load availability");
        const json = (await res.json()) as { days: TeamSlotDay[] };
        setState({ key, days: json.days });
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setState({ key, days: [], error: "We couldn't load available times. Please try again." });
      });
    return () => controller.abort();
  }, [key, sessionSlug, coach, from, to, tz, rescheduleToken]);

  const loading = !state || state.key !== key;
  const days = useMemo(() => {
    if (loading) return [] as TeamSlotDay[];
    return state.days
      .map((d) => ({ ...d, slots: showFull ? d.slots : d.slots.filter((s) => s.spotsLeft > 0) }))
      .filter((d) => d.slots.length > 0);
  }, [state, loading, showFull]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d.slots])), [days]);
  const activeDate = pickedDate && byDate.has(pickedDate) ? pickedDate : (days[0]?.date ?? null);
  const activeSlots = activeDate ? (byDate.get(activeDate) ?? []) : [];

  const firstWeekday = weekdayOf(from);
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth(month) }, (_, i) => addDays(from, i)),
  ];
  const { y, m } = parseDate(from);
  const earliestMonth = minMonth ?? initialMonth;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setMonth(shiftMonth(month, -1));
              setPickedDate(null);
            }}
            disabled={month <= earliestMonth}
            className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Previous month"
          >
            ‹
          </button>
          <p className="font-semibold" aria-live="polite">
            {MONTHS[m - 1]} {y}
          </p>
          <button
            type="button"
            onClick={() => {
              setMonth(shiftMonth(month, 1));
              setPickedDate(null);
            }}
            className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500" aria-hidden>
          {WEEKDAYS.map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Choose a date">
          {cells.map((date, i) =>
            date ? (
              <button
                key={date}
                type="button"
                disabled={!byDate.has(date)}
                onClick={() => {
                  setPickedDate(date);
                  onSelect(null, tz);
                }}
                aria-pressed={date === activeDate}
                aria-label={`${MONTHS[m - 1]} ${Number(date.slice(8))}${byDate.has(date) ? ", available" : ""}`}
                className={cn(
                  "aspect-square rounded-full text-sm font-medium transition-colors",
                  date === activeDate
                    ? "bg-brand text-on-brand"
                    : byDate.has(date)
                      ? "bg-brand/10 text-brand hover:bg-brand/20"
                      : "text-zinc-300 dark:text-zinc-700",
                )}
              >
                {Number(date.slice(8))}
              </button>
            ) : (
              <span key={`blank-${i}`} />
            ),
          )}
        </div>
        <div className="mt-4">
          <label htmlFor="tz-select" className="text-xs font-medium text-zinc-500">
            Times shown in
          </label>
          <Select id="tz-select" value={tz} onChange={(e) => { setTzOverride(e.target.value); onSelect(null, e.target.value); }} className="mt-1">
            {!timezones.includes(tz) ? <option value={tz}>{tz.replace(/_/g, " ")}</option> : null}
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <p className="mb-3 font-semibold">
          {activeDate ? formatInTimeZone(`${activeDate}T12:00:00Z`, "UTC", "EEEE, MMMM d") : "Available times"}
        </p>
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
        ) : state?.error ? (
          <p className="text-sm text-red-600">{state.error}</p>
        ) : activeSlots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            No open times this month. Try the next month.
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
            {activeSlots.map((slot) => {
              const isSelected = selected?.start === slot.start;
              const full = slot.spotsLeft === 0;
              return (
                <li key={slot.start}>
                  <button
                    type="button"
                    onClick={() => onSelect(slot, tz)}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex h-11 w-full items-center justify-between rounded-xl border px-4 text-sm font-semibold transition-colors",
                      isSelected
                        ? "border-brand bg-brand text-on-brand"
                        : full
                          ? "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800"
                          : "border-brand/40 text-brand hover:border-brand hover:bg-brand/5",
                    )}
                  >
                    <span>{formatInTimeZone(slot.start, tz, "h:mm a")}</span>
                    {slot.capacity > 1 ? (
                      <span className={cn("text-xs font-medium", isSelected ? "text-on-brand/90" : "text-zinc-500")}>
                        {full ? "Full · waitlist" : `${slot.spotsLeft} of ${slot.capacity} left`}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
