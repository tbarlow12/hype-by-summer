import { describe, expect, it } from "vitest";
import { computeSlotDays, computeSlots, groupSlotsByDate, parseTstzRange, type SlotEngineInput } from "./slots";
import { addDays, weekdayOf, zonedTimeToUtc } from "./tz";

const TZ = "America/New_York";
const ST = {
  id: "st-1",
  duration_minutes: 60,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  slot_interval_minutes: 30,
  min_notice_minutes: 0,
  max_advance_days: 365,
  capacity: 1,
};

// Mon–Fri 09:00–12:00 New York.
const WEEKDAY_RULES = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: "09:00:00", end_time: "12:00:00" }));

function input(overrides: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {
    timezone: TZ,
    rules: WEEKDAY_RULES,
    overrides: [],
    busy: [],
    sessionType: ST,
    // Monday 2026-10-12 .. Saturday 2026-10-17 (EDT, UTC-4)
    from: new Date("2026-10-12T04:00:00Z"),
    to: new Date("2026-10-17T04:00:00Z"),
    now: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

const starts = (i: SlotEngineInput) => computeSlots(i).map((s) => s.start);

describe("tz helpers", () => {
  it("knows weekdays and adds days across months", () => {
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("converts wall time to UTC across DST", () => {
    expect(zonedTimeToUtc("2026-03-07", 9 * 60, TZ).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-09", 9 * 60, TZ).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    // Skipped hour moves forward.
    expect(zonedTimeToUtc("2026-03-08", 2 * 60 + 30, TZ).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // Repeated hour resolves to the first occurrence (EDT).
    expect(zonedTimeToUtc("2026-11-01", 60 + 30, TZ).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("computeSlots", () => {
  it("generates interval-aligned slots that fit the window", () => {
    const monday = computeSlots(input()).filter((s) => s.start.startsWith("2026-10-12"));
    // 09:00, 09:30, 10:00, 10:30, 11:00 EDT (11:30 would end after 12:00)
    expect(monday.map((s) => s.start)).toEqual([
      "2026-10-12T13:00:00.000Z",
      "2026-10-12T13:30:00.000Z",
      "2026-10-12T14:00:00.000Z",
      "2026-10-12T14:30:00.000Z",
      "2026-10-12T15:00:00.000Z",
    ]);
    expect(monday[0]).toMatchObject({ end: "2026-10-12T14:00:00.000Z", spotsLeft: 1, capacity: 1 });
  });

  it("returns 25 slots for a Mon–Fri week and nothing on weekends", () => {
    const days = computeSlotDays(input({ to: new Date("2026-10-19T04:00:00Z") }));
    expect(days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(days.reduce((n, d) => n + d.slots.length, 0)).toBe(25);
  });

  it("keeps local wall-clock hours through the US DST change (spring forward)", () => {
    // Week of 2026-03-08: Fri 6th is EST (UTC-5), Mon 9th is EDT (UTC-4).
    const slots = computeSlots(
      input({ from: new Date("2026-03-06T05:00:00Z"), to: new Date("2026-03-10T04:00:00Z"), now: new Date("2026-03-01T00:00:00Z") }),
    );
    const friday = slots.filter((s) => s.start.startsWith("2026-03-06"));
    const monday = slots.filter((s) => s.start.startsWith("2026-03-09"));
    expect(friday[0]!.start).toBe("2026-03-06T14:00:00.000Z");
    expect(monday[0]!.start).toBe("2026-03-09T13:00:00.000Z");
    expect(friday).toHaveLength(5);
    expect(monday).toHaveLength(5);
  });

  it("keeps local wall-clock hours through the US DST change (fall back)", () => {
    const rules = [0, 1, 5, 6].map((weekday) => ({ weekday, start_time: "09:00", end_time: "12:00" }));
    const days = computeSlotDays(
      input({ rules, from: new Date("2026-10-30T04:00:00Z"), to: new Date("2026-11-03T05:00:00Z"), now: new Date("2026-10-01T00:00:00Z") }),
    );
    const firstByDate = Object.fromEntries(days.map((d) => [d.date, d.slots[0]!.start]));
    expect(firstByDate["2026-10-30"]).toBe("2026-10-30T13:00:00.000Z"); // Fri EDT
    expect(firstByDate["2026-10-31"]).toBe("2026-10-31T13:00:00.000Z"); // Sat EDT
    expect(firstByDate["2026-11-01"]).toBe("2026-11-01T14:00:00.000Z"); // Sun EST
    expect(firstByDate["2026-11-02"]).toBe("2026-11-02T14:00:00.000Z"); // Mon EST
    for (const d of days) expect(d.slots).toHaveLength(5);
  });

  it("handles a window spanning the skipped hour (2 real hours on spring-forward night)", () => {
    const rules = [{ weekday: 0, start_time: "01:00", end_time: "04:00" }];
    const slots = computeSlots(
      input({
        rules,
        sessionType: { ...ST, slot_interval_minutes: 60 },
        from: new Date("2026-03-08T05:00:00Z"),
        to: new Date("2026-03-09T04:00:00Z"),
        now: new Date("2026-03-01T00:00:00Z"),
      }),
    );
    // 01:00 EST (06:00Z) and 03:00 EDT (07:00Z); window ends 04:00 EDT (08:00Z).
    expect(slots.map((s) => s.start)).toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]);
  });

  it("supports windows that end at midnight (24:00)", () => {
    const rules = [{ weekday: 1, start_time: "22:00", end_time: "24:00:00" }];
    const slots = computeSlots(input({ rules }));
    expect(slots.map((s) => s.start)).toEqual([
      "2026-10-13T02:00:00.000Z",
      "2026-10-13T02:30:00.000Z",
      "2026-10-13T03:00:00.000Z",
    ]);
  });

  it("respects minimum notice and max advance days", () => {
    const now = new Date("2026-10-12T13:10:00Z"); // Monday 09:10 EDT
    const notice = computeSlots(input({ now, sessionType: { ...ST, min_notice_minutes: 60 } }));
    expect(notice[0]!.start).toBe("2026-10-12T14:30:00.000Z"); // first >= 10:10
    const advance = computeSlots(input({ now, sessionType: { ...ST, max_advance_days: 1 } }));
    expect(advance.every((s) => Date.parse(s.start) < now.getTime() + 86_400_000)).toBe(true);
    expect(advance.at(-1)!.start).toBe("2026-10-13T13:00:00.000Z");
  });

  it("never offers slots in the past", () => {
    const now = new Date("2026-10-14T15:00:00Z");
    expect(computeSlots(input({ now })).every((s) => s.start >= now.toISOString())).toBe(true);
  });

  it("filters rules by session type", () => {
    const rules = [
      { weekday: 1, start_time: "09:00", end_time: "10:00", session_type_ids: ["other"] },
      { weekday: 1, start_time: "14:00", end_time: "15:00", session_type_ids: ["st-1"] },
      { weekday: 1, start_time: "16:00", end_time: "17:00", session_type_ids: null },
    ];
    expect(starts(input({ rules, to: new Date("2026-10-13T04:00:00Z") }))).toEqual([
      "2026-10-12T18:00:00.000Z",
      "2026-10-12T20:00:00.000Z",
    ]);
  });

  it("removes booked time including both bookings' buffers", () => {
    const busy = [
      {
        session_type_id: "other",
        starts_at: "2026-10-12T14:00:00Z",
        // 10:00–11:00 EDT session with a 15 min buffer after
        blocked_start: "2026-10-12T14:00:00Z",
        blocked_end: "2026-10-12T15:15:00Z",
      },
    ];
    const monday = starts(input({ busy, to: new Date("2026-10-13T04:00:00Z") }));
    expect(monday).toEqual(["2026-10-12T13:00:00.000Z"]); // only 09:00 fits before; 11:00 hits buffer
    const withBuffer = starts(
      input({ busy, sessionType: { ...ST, buffer_after_minutes: 30 }, to: new Date("2026-10-13T04:00:00Z") }),
    );
    expect(withBuffer).toEqual([]); // 09:00 + 60 + 30 buffer collides at 10:00
    const withBefore = starts(
      input({
        busy,
        sessionType: { ...ST, duration_minutes: 30, buffer_before_minutes: 15 },
        to: new Date("2026-10-13T04:00:00Z"),
      }),
    );
    // 11:30 needs 11:15 free: ok (busy ends 11:15). 11:00 would need 10:45: blocked.
    expect(withBefore).toContain("2026-10-12T15:30:00.000Z");
    expect(withBefore).not.toContain("2026-10-12T15:00:00.000Z");
  });

  it("ignores an excluded booking (rescheduling it)", () => {
    const busy = [
      { id: "b1", session_type_id: "st-1", starts_at: "2026-10-12T13:00:00Z", blocked_start: "2026-10-12T13:00:00Z", blocked_end: "2026-10-12T14:00:00Z" },
    ];
    const to = new Date("2026-10-13T04:00:00Z");
    expect(starts(input({ busy, to }))).not.toContain("2026-10-12T13:30:00.000Z");
    expect(starts(input({ busy, to, excludeBookingId: "b1" }))).toContain("2026-10-12T13:30:00.000Z");
  });

  it("tracks group capacity and spots left", () => {
    const group = { ...ST, capacity: 3 };
    const one = { session_type_id: "st-1", starts_at: "2026-10-12T13:00:00Z", blocked_start: "2026-10-12T13:00:00Z", blocked_end: "2026-10-12T14:00:00Z" };
    const to = new Date("2026-10-13T04:00:00Z");
    const slots = computeSlots(input({ sessionType: group, busy: [one, one], to }));
    expect(slots[0]).toMatchObject({ start: "2026-10-12T13:00:00.000Z", spotsLeft: 1, capacity: 3 });
    // The group booking blocks other start times that overlap it.
    expect(slots.map((s) => s.start)).not.toContain("2026-10-12T13:30:00.000Z");

    const full = [one, one, one];
    expect(computeSlots(input({ sessionType: group, busy: full, to })).map((s) => s.start)).not.toContain("2026-10-12T13:00:00.000Z");
    const withFull = computeSlots(input({ sessionType: group, busy: full, to, includeFull: true }));
    expect(withFull[0]).toMatchObject({ start: "2026-10-12T13:00:00.000Z", spotsLeft: 0 });
  });

  it("does not offer full 1:1 slots even with includeFull", () => {
    const one = { session_type_id: "st-1", starts_at: "2026-10-12T13:00:00Z", blocked_start: "2026-10-12T13:00:00Z", blocked_end: "2026-10-12T14:00:00Z" };
    const slots = computeSlots(input({ busy: [one], includeFull: true, to: new Date("2026-10-13T04:00:00Z") }));
    expect(slots.map((s) => s.start)).not.toContain("2026-10-12T13:00:00.000Z");
  });

  it("treats a different session type at the same start as a conflict", () => {
    const other = { session_type_id: "x", starts_at: "2026-10-12T13:00:00Z", blocked_start: "2026-10-12T13:00:00Z", blocked_end: "2026-10-12T14:00:00Z" };
    const slots = computeSlots(input({ sessionType: { ...ST, capacity: 5 }, busy: [other], to: new Date("2026-10-13T04:00:00Z") }));
    expect(slots.map((s) => s.start)).not.toContain("2026-10-12T13:00:00.000Z");
  });

  it("removes time off and adds extra hours", () => {
    const overrides = [
      // Tuesday 10:00–11:00 EDT off
      { starts_at: "2026-10-13T14:00:00Z", ends_at: "2026-10-13T15:00:00Z", is_available: false },
      // Saturday 08:00–10:00 EDT extra
      { starts_at: "2026-10-17T12:00:00Z", ends_at: "2026-10-17T14:00:00Z", is_available: true },
      // Extra hours that extend Monday until 13:00
      { starts_at: "2026-10-12T16:00:00Z", ends_at: "2026-10-12T17:00:00Z", is_available: true },
    ];
    const days = computeSlotDays(input({ overrides, to: new Date("2026-10-19T04:00:00Z") }));
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.slots.map((s) => s.start)]));
    expect(byDate["2026-10-13"]).toEqual(["2026-10-13T13:00:00.000Z", "2026-10-13T15:00:00.000Z"]);
    expect(byDate["2026-10-17"]).toEqual([
      "2026-10-17T12:00:00.000Z",
      "2026-10-17T12:30:00.000Z",
      "2026-10-17T13:00:00.000Z",
    ]);
    // Monday window merges 09:00–13:00 → last start 12:00.
    expect(byDate["2026-10-12"]!.at(-1)).toBe("2026-10-12T16:00:00.000Z");
    expect(byDate["2026-10-12"]).toHaveLength(7);
  });

  it("time off wins over extra hours and can remove whole days", () => {
    const overrides = [
      { starts_at: "2026-10-14T04:00:00Z", ends_at: "2026-10-15T04:00:00Z", is_available: false },
      { starts_at: "2026-10-14T20:00:00Z", ends_at: "2026-10-14T22:00:00Z", is_available: true },
    ];
    const days = computeSlotDays(input({ overrides }));
    expect(days.map((d) => d.date)).not.toContain("2026-10-14");
  });

  it("returns nothing when there are no rules", () => {
    expect(computeSlots(input({ rules: [] }))).toEqual([]);
  });

  it("limits results to the requested range", () => {
    const slots = computeSlots(input({ from: new Date("2026-10-13T14:00:00Z"), to: new Date("2026-10-13T15:00:00Z") }));
    expect(slots.map((s) => s.start)).toEqual(["2026-10-13T14:00:00.000Z", "2026-10-13T14:30:00.000Z"]);
  });
});

describe("groupSlotsByDate", () => {
  it("groups by the viewer's timezone", () => {
    const slots = computeSlots(input({ rules: [{ weekday: 1, start_time: "20:00", end_time: "22:00" }] }));
    // 20:00 EDT Monday = 09:00 Tuesday in Tokyo.
    const ny = groupSlotsByDate(slots, TZ);
    const tokyo = groupSlotsByDate(slots, "Asia/Tokyo");
    expect(ny.map((d) => d.date)).toEqual(["2026-10-12"]);
    expect(tokyo.map((d) => d.date)).toEqual(["2026-10-13"]);
    expect(tokyo[0]!.slots).toHaveLength(3);
  });
});

describe("parseTstzRange", () => {
  it("parses Postgres range literals", () => {
    expect(parseTstzRange('["2030-01-07 14:00:00+00","2030-01-07 16:15:00+00")')).toEqual({
      start: "2030-01-07T14:00:00.000Z",
      end: "2030-01-07T16:15:00.000Z",
    });
    expect(parseTstzRange('["2030-01-07 09:00:00-05","2030-01-07 10:00:00-05")')).toEqual({
      start: "2030-01-07T14:00:00.000Z",
      end: "2030-01-07T15:00:00.000Z",
    });
    expect(parseTstzRange("empty")).toBeNull();
  });
});
