import { describe, expect, it } from "vitest";
import { computeTeamSlots, groupSlotsByDate, orderCoachCandidates, type CoachAvailabilityInput } from "./slots";

// Multi-coach ("any available coach") slot union and assignment order.

const ST = {
  id: "st-1",
  duration_minutes: 60,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  slot_interval_minutes: 60,
  min_notice_minutes: 0,
  max_advance_days: 365,
  capacity: 1,
};
// Monday 2026-10-12, whole day in UTC terms for both zones used below.
const FROM = new Date("2026-10-12T00:00:00Z");
const TO = new Date("2026-10-13T12:00:00Z");
const NOW = new Date("2026-10-01T00:00:00Z");

const coach = (coachId: string, over: Partial<CoachAvailabilityInput> = {}): CoachAvailabilityInput => ({
  coachId,
  timezone: "America/New_York",
  rules: [{ weekday: 1, start_time: "09:00", end_time: "12:00" }],
  overrides: [],
  busy: [],
  ...over,
});

const team = (coaches: CoachAvailabilityInput[], st = ST) => computeTeamSlots({ coaches, sessionType: st, from: FROM, to: TO, now: NOW });

describe("computeTeamSlots", () => {
  it("unions coaches' hours and lists who is free at each start", () => {
    const slots = team([
      coach("a"), // 09–12 EDT = 13–16Z
      coach("b", { rules: [{ weekday: 1, start_time: "11:00", end_time: "14:00" }] }), // 15–18Z
    ]);
    expect(slots.map((s) => [s.start.slice(11, 16), s.coachIds])).toEqual([
      ["13:00", ["a"]],
      ["14:00", ["a"]],
      ["15:00", ["a", "b"]],
      ["16:00", ["b"]],
      ["17:00", ["b"]],
    ]);
    expect(slots[2]).toMatchObject({ spotsLeft: 2, capacity: 2 });
  });

  it("uses each coach's own timezone", () => {
    const slots = team([coach("ny"), coach("la", { timezone: "America/Los_Angeles" })]);
    const la = slots.filter((s) => s.coachIds.includes("la")).map((s) => s.start.slice(11, 16));
    // 09:00 PDT = 16:00Z
    expect(la).toEqual(["16:00", "17:00", "18:00"]);
    expect(slots.find((s) => s.start.endsWith("16:00:00.000Z"))?.coachIds).toEqual(["la"]);
  });

  it("drops a coach who is busy (with buffers) but keeps the others", () => {
    const busy = [{ id: "b1", session_type_id: "other", starts_at: "2026-10-12T14:00:00Z", blocked_start: "2026-10-12T13:45:00Z", blocked_end: "2026-10-12T15:15:00Z" }];
    const slots = team([coach("a", { busy }), coach("b")]);
    const at = (hhmm: string) => slots.find((s) => s.start.slice(11, 16) === hhmm)?.coachIds;
    expect(at("13:00")).toEqual(["b"]); // a's busy window (buffer) starts 13:45
    expect(at("14:00")).toEqual(["b"]);
    expect(at("15:00")).toEqual(["b"]); // buffer runs to 15:15
  });

  it("removes a start only when every coach is unavailable", () => {
    const off = [{ starts_at: "2026-10-12T13:00:00Z", ends_at: "2026-10-12T16:00:00Z", is_available: false }];
    expect(team([coach("a", { overrides: off }), coach("b", { overrides: off })])).toEqual([]);
    expect(team([coach("a", { overrides: off }), coach("b")]).every((s) => s.coachIds.join() === "b")).toBe(true);
  });

  it("sums group capacity and lists full coaches only when everyone is full", () => {
    const group = { ...ST, capacity: 2 };
    const seat = (id: string) => ({ id, session_type_id: "st-1", starts_at: "2026-10-12T13:00:00Z", blocked_start: "2026-10-12T13:00:00Z", blocked_end: "2026-10-12T14:00:00Z" });
    const aFull = coach("a", { busy: [seat("1"), seat("2")] });
    const bOne = coach("b", { busy: [seat("3")] });
    const first = computeTeamSlots({ coaches: [aFull, bOne], sessionType: group, from: FROM, to: TO, now: NOW, includeFull: true })[0]!;
    expect(first).toMatchObject({ spotsLeft: 1, capacity: 4, coachIds: ["b"] });

    const bFull = coach("b", { busy: [seat("3"), seat("4")] });
    const full = computeTeamSlots({ coaches: [aFull, bFull], sessionType: group, from: FROM, to: TO, now: NOW, includeFull: true })[0]!;
    expect(full).toMatchObject({ spotsLeft: 0, capacity: 4, coachIds: ["a", "b"] });
    // Without includeFull the full start is gone.
    expect(computeTeamSlots({ coaches: [aFull, bFull], sessionType: group, from: FROM, to: TO, now: NOW })[0]!.start).toBe("2026-10-12T14:00:00.000Z");
  });

  it("groups team slots by the viewer's date", () => {
    const days = groupSlotsByDate(team([coach("a")]), "Asia/Tokyo");
    expect(days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(days.flatMap((d) => d.slots).every((s) => s.coachIds.length === 1)).toBe(true);
  });
});

describe("orderCoachCandidates", () => {
  it("puts the client's primary coach first when free, then the session type order", () => {
    expect(orderCoachCandidates(["a", "b", "c"], { preferred: "c", order: ["b", "a", "c"] })).toEqual(["c", "b", "a"]);
  });

  it("ignores a preferred coach who isn't free", () => {
    expect(orderCoachCandidates(["a", "b"], { preferred: "z", order: ["b", "a"] })).toEqual(["b", "a"]);
  });

  it("keeps free coaches missing from the order and drops ordered coaches who aren't free", () => {
    expect(orderCoachCandidates(["x", "a"], { order: ["b", "a"] })).toEqual(["a", "x"]);
    expect(orderCoachCandidates([], { preferred: "a", order: ["a"] })).toEqual([]);
  });
});
