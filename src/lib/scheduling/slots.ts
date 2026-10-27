import { addDays, localDateOf, timeToMinutes, weekdayOf, zonedTimeToUtc } from "./tz";

// Pure slot engine: given a trainer's weekly hours, overrides and existing
// bookings, produce the bookable start times for one session type. No I/O.

export type AvailabilityRuleInput = {
  weekday: number; // 0 = Sunday, trainer-local
  start_time: string; // "HH:mm[:ss]" trainer-local
  end_time: string; // "HH:mm[:ss]", may be "24:00"
  session_type_ids?: string[] | null; // null/empty = every type
};

export type AvailabilityOverrideInput = {
  starts_at: string; // UTC ISO
  ends_at: string;
  is_available: boolean; // true = extra hours, false = time off
};

export type BusyBookingInput = {
  id?: string;
  session_type_id: string;
  starts_at: string;
  /** Busy window including that booking's buffers (bookings.blocked_range). */
  blocked_start: string;
  blocked_end: string;
};

export type SessionTypeInput = {
  id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
  capacity: number;
};

export type SlotEngineInput = {
  timezone: string; // trainer timezone
  rules: AvailabilityRuleInput[];
  overrides: AvailabilityOverrideInput[];
  busy: BusyBookingInput[];
  sessionType: SessionTypeInput;
  /** Inclusive start / exclusive end of the range to search (UTC instants). */
  from: Date;
  to: Date;
  now: Date;
  /** Ignore this booking when checking conflicts (rescheduling it). */
  excludeBookingId?: string;
  /** Include group slots that are full (spotsLeft 0) so the UI can offer a waitlist. */
  includeFull?: boolean;
};

export type Slot = {
  start: string; // UTC ISO
  end: string;
  spotsLeft: number;
  capacity: number;
};

export type SlotDay = { date: string; slots: Slot[] };

type Interval = { start: number; end: number };

const MIN = 60_000;

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function subtractIntervals(base: Interval[], remove: Interval[]): Interval[] {
  let result = base;
  for (const r of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (r.end <= b.start || r.start >= b.end) {
        next.push(b);
        continue;
      }
      if (r.start > b.start) next.push({ start: b.start, end: r.start });
      if (r.end < b.end) next.push({ start: r.end, end: b.end });
    }
    result = next;
  }
  return result;
}

/** Free windows (UTC) in which a session of this type may take place. */
export function availableWindows(input: Pick<SlotEngineInput, "timezone" | "rules" | "overrides" | "sessionType" | "from" | "to">): Interval[] {
  const { timezone, rules, overrides, sessionType, from, to } = input;
  const windows: Interval[] = [];
  // Walk trainer-local dates with a day of margin on both sides.
  const first = addDays(localDateOf(from, timezone), -1);
  const last = addDays(localDateOf(to, timezone), 1);
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const weekday = weekdayOf(date);
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      if (rule.session_type_ids && rule.session_type_ids.length > 0 && !rule.session_type_ids.includes(sessionType.id)) continue;
      const start = zonedTimeToUtc(date, timeToMinutes(rule.start_time), timezone).getTime();
      const endMinutes = timeToMinutes(rule.end_time);
      const end = (endMinutes >= 1440
        ? zonedTimeToUtc(addDays(date, 1), endMinutes - 1440, timezone)
        : zonedTimeToUtc(date, endMinutes, timezone)
      ).getTime();
      windows.push({ start, end });
    }
  }
  for (const o of overrides) {
    if (o.is_available) windows.push({ start: Date.parse(o.starts_at), end: Date.parse(o.ends_at) });
  }
  const timeOff = overrides
    .filter((o) => !o.is_available)
    .map((o) => ({ start: Date.parse(o.starts_at), end: Date.parse(o.ends_at) }));
  return subtractIntervals(mergeIntervals(windows), timeOff);
}

/** Every bookable slot in [from, to), sorted by start time. */
export function computeSlots(input: SlotEngineInput): Slot[] {
  const { sessionType: st, busy, now, excludeBookingId } = input;
  const duration = st.duration_minutes * MIN;
  const interval = Math.max(5, st.slot_interval_minutes) * MIN;
  const earliest = Math.max(input.from.getTime(), now.getTime() + st.min_notice_minutes * MIN);
  const latest = Math.min(input.to.getTime(), now.getTime() + st.max_advance_days * 1440 * MIN);
  if (earliest >= latest) return [];

  const busyParsed = busy
    .filter((b) => !excludeBookingId || b.id !== excludeBookingId)
    .map((b) => ({
      sameType: b.session_type_id === st.id,
      start: Date.parse(b.starts_at),
      blockedStart: Date.parse(b.blocked_start),
      blockedEnd: Date.parse(b.blocked_end),
    }));

  const slots: Slot[] = [];
  for (const w of availableWindows(input)) {
    // Slots are aligned to the interval from the start of each free window.
    for (let start = w.start; start + duration <= w.end; start += interval) {
      if (start < earliest || start >= latest) continue;
      const end = start + duration;
      const blockStart = start - st.buffer_before_minutes * MIN;
      const blockEnd = end + st.buffer_after_minutes * MIN;
      let taken = 0;
      let conflict = false;
      for (const b of busyParsed) {
        if (b.sameType && b.start === start) {
          taken += 1;
          continue;
        }
        if (b.blockedStart < blockEnd && b.blockedEnd > blockStart) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;
      const spotsLeft = Math.max(0, st.capacity - taken);
      if (spotsLeft === 0 && !(input.includeFull && st.capacity > 1)) continue;
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), spotsLeft, capacity: st.capacity });
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  // Windows are merged, so duplicates only arise from identical starts.
  return slots.filter((s, i) => i === 0 || slots[i - 1]!.start !== s.start);
}

/** Groups slots by calendar date in the given (viewer) timezone. */
export function groupSlotsByDate(slots: Slot[], timeZone: string): SlotDay[] {
  const days = new Map<string, Slot[]>();
  for (const slot of slots) {
    const date = localDateOf(slot.start, timeZone);
    const list = days.get(date);
    if (list) list.push(slot);
    else days.set(date, [slot]);
  }
  return [...days.entries()].map(([date, list]) => ({ date, slots: list }));
}

/** Convenience: compute + group in one call. */
export function computeSlotDays(input: SlotEngineInput & { displayTimezone?: string }): SlotDay[] {
  return groupSlotsByDate(computeSlots(input), input.displayTimezone ?? input.timezone);
}

/** Parses a Postgres tstzrange literal like `["2030-01-07 14:00:00+00","2030-01-07 16:15:00+00")`. */
export function parseTstzRange(range: string): { start: string; end: string } | null {
  const match = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(range.trim());
  if (!match) return null;
  const toIso = (s: string) => {
    // Postgres: "2030-01-07 14:00:00+00" -> ISO
    const normalized = s.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const start = toIso(match[1]!);
  const end = toIso(match[2]!);
  return start && end ? { start, end } : null;
}
