import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  creditBuckets,
  greeting,
  isLowOnCredits,
  matchesSearch,
  monthlyRecurringCents,
  netPaidCents,
  parseTags,
  programPosition,
  timeAgo,
  zonedDayRange,
  zonedMonthStart,
  zonedWeekRange,
} from "./metrics";
import { intakeComplete, parqFlags, readParqAnswers, PARQ_QUESTIONS } from "./intake";
import { onboardingSteps, paperworkDone, waiverCurrent } from "./onboarding";
import { WAIVER_VERSION, waiverSections } from "./waiver";

describe("time ranges", () => {
  // 2026-10-27 is a Tuesday. 05:30Z = 23:30 Monday in Denver (UTC-6 in Oct).
  const now = new Date("2026-10-27T05:30:00Z");

  it("computes the local day in the viewer's timezone", () => {
    const { start, end } = zonedDayRange("America/Denver", now);
    expect(start.toISOString()).toBe("2026-10-26T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-27T06:00:00.000Z");
  });

  it("weeks start on Monday", () => {
    const denver = zonedWeekRange("America/Denver", now);
    expect(denver.monday).toBe("2026-10-26");
    const tokyo = zonedWeekRange("Asia/Tokyo", now); // Tuesday 14:30 in Tokyo
    expect(tokyo.monday).toBe("2026-10-26");
    expect(tokyo.start.toISOString()).toBe("2026-10-25T15:00:00.000Z");
    // Sunday belongs to the previous week.
    expect(zonedWeekRange("UTC", new Date("2026-11-01T12:00:00Z")).monday).toBe("2026-10-26");
  });

  it("handles DST in week ranges (US fall back on Nov 1 2026)", () => {
    const { start, end } = zonedWeekRange("America/Denver", new Date("2026-10-28T12:00:00Z"));
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(7 * 24 + 1);
  });

  it("month start", () => {
    expect(zonedMonthStart("America/Denver", now).toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("date string arithmetic", () => {
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("greeting", () => {
    expect(greeting("UTC", new Date("2026-10-27T08:00:00Z"))).toBe("Good morning");
    expect(greeting("UTC", new Date("2026-10-27T19:00:00Z"))).toBe("Good evening");
  });
});

describe("credits", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const rows = [
    { id: "g1", delta: 5, grant_id: null, expires_at: "2026-12-01T00:00:00Z", session_type_ids: null },
    { id: "d1", delta: -2, grant_id: "g1", expires_at: null, session_type_ids: null },
    { id: "g2", delta: 3, grant_id: null, expires_at: null, session_type_ids: null },
    { id: "g3", delta: 4, grant_id: null, expires_at: "2026-10-01T00:00:00Z", session_type_ids: null }, // expired
    { id: "g4", delta: 2, grant_id: null, expires_at: null, session_type_ids: ["b", "a"] },
    { id: "g5", delta: 1, grant_id: null, expires_at: null, session_type_ids: ["a", "b"] },
    { id: "g6", delta: 1, grant_id: null, expires_at: null, session_type_ids: ["c"] },
    { id: "d6", delta: -1, grant_id: "g6", expires_at: null, session_type_ids: null }, // fully used
  ];

  it("groups remaining credits by restriction", () => {
    expect(creditBuckets(rows, now)).toEqual([
      { sessionTypeIds: null, remaining: 6, nextExpiry: "2026-12-01T00:00:00Z" },
      { sessionTypeIds: ["a", "b"], remaining: 3, nextExpiry: null },
    ]);
  });

  it("flags low credits only for package buyers", () => {
    expect(isLowOnCredits(1, 10)).toBe(true);
    expect(isLowOnCredits(0, 0)).toBe(false);
    expect(isLowOnCredits(2, 10)).toBe(false);
  });
});

describe("money", () => {
  it("normalises MRR across intervals and ignores non-paying statuses", () => {
    expect(
      monthlyRecurringCents([
        { status: "active", price_cents: 20000, billing_interval: "month", interval_count: 1 },
        { status: "past_due", price_cents: 120000, billing_interval: "year", interval_count: 1 },
        { status: "active", price_cents: 6000, billing_interval: "week", interval_count: 2 },
        { status: "trialing", price_cents: 20000, billing_interval: "month", interval_count: 1 },
        { status: "canceled", price_cents: 20000, billing_interval: "month", interval_count: 1 },
      ]),
    ).toBe(20000 + 10000 + 13000);
  });

  it("net paid subtracts refunds and skips failures", () => {
    expect(
      netPaidCents([
        { status: "succeeded", amount_cents: 9000, amount_refunded_cents: 0 },
        { status: "partially_refunded", amount_cents: 9000, amount_refunded_cents: 4000 },
        { status: "refunded", amount_cents: 5000, amount_refunded_cents: 5000 },
        { status: "failed", amount_cents: 9000, amount_refunded_cents: 0 },
        { status: "pending", amount_cents: 9000, amount_refunded_cents: 0 },
      ]),
    ).toBe(14000);
  });
});

describe("programs", () => {
  it("maps a date to week/day", () => {
    expect(programPosition("2026-10-26", "2026-10-26", 4)).toEqual({ week: 1, day: 1 });
    expect(programPosition("2026-10-26", "2026-11-03", 4)).toEqual({ week: 2, day: 2 });
    expect(programPosition("2026-10-26", "2026-10-25", 4)).toBeNull();
    expect(programPosition("2026-10-01", "2026-10-29", 4)).toBeNull();
  });
});

describe("roster helpers", () => {
  it("parses tags", () => {
    expect(parseTags(" vip, Morning  crew,VIP,, hybrid\nnew ")).toEqual(["vip", "Morning crew", "hybrid", "new"]);
    expect(parseTags("")).toEqual([]);
  });
  it("searches case-insensitively", () => {
    expect(matchesSearch("ann", ["Annie Smith", null])).toBe(true);
    expect(matchesSearch("bob", ["Annie", "annie@example.com"])).toBe(false);
    expect(matchesSearch("  ", ["x"])).toBe(true);
  });
});

describe("intake + onboarding", () => {
  const allNo = Object.fromEntries(PARQ_QUESTIONS.map((q) => [q.key, false]));
  const fullIntake = {
    answers: allNo,
    experience_level: "beginner",
    primary_goal: "strength",
    emergency_contact_name: "Pat",
    emergency_contact_phone: "555",
    waiver_accepted_at: "2026-10-27T00:00:00Z",
    waiver_version: WAIVER_VERSION,
  };

  it("reads answers defensively and flags yeses", () => {
    expect(readParqAnswers({ heart_condition: true, chest_pain: "yes", bogus: true })).toEqual({ heart_condition: true });
    expect(readParqAnswers(null)).toEqual({});
    expect(parqFlags({ heart_condition: true, dizziness: false, pregnant: true })).toEqual(["heart_condition", "pregnant"]);
  });

  it("requires every question and the emergency contact", () => {
    expect(intakeComplete(fullIntake)).toBe(true);
    expect(intakeComplete({ ...fullIntake, answers: { heart_condition: false } })).toBe(false);
    expect(intakeComplete({ ...fullIntake, emergency_contact_phone: null })).toBe(false);
    expect(intakeComplete(null)).toBe(false);
  });

  it("asks for a new signature when the waiver version changes", () => {
    expect(waiverCurrent(fullIntake)).toBe(true);
    expect(waiverCurrent({ ...fullIntake, waiver_version: "old" })).toBe(false);
    expect(waiverCurrent(null)).toBe(false);
  });

  it("builds the checklist", () => {
    const steps = onboardingSteps({
      profile: { full_name: "Ann", phone: "555" },
      intake: fullIntake,
      hasBooking: false,
    });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["profile", true],
      ["intake", true],
      ["waiver", true],
      ["book", false],
    ]);
    expect(paperworkDone(steps)).toBe(true);
    const fresh = onboardingSteps({ profile: { full_name: null, phone: null }, intake: null, hasBooking: false });
    expect(fresh.every((s) => !s.done)).toBe(true);
    expect(paperworkDone(fresh)).toBe(false);
  });

  it("waiver template names the business", () => {
    expect(waiverSections("Acme Fitness")[0]!.body).toContain("Acme Fitness");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("formats", () => {
    expect(timeAgo("2026-10-27T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-27T11:15:00Z", now)).toBe("45m ago");
    expect(timeAgo("2026-10-27T02:00:00Z", now)).toBe("10h ago");
    expect(timeAgo("2026-10-24T12:00:00Z", now)).toBe("3d ago");
    expect(timeAgo("2026-09-01T12:00:00Z", now)).toBe("Sep 1");
  });
});
