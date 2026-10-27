import { describe, expect, it } from "vitest";
import { scoreLead, scoreTier } from "./score";

describe("scoreLead", () => {
  it("scores an empty lead at zero", () => {
    expect(scoreLead({})).toEqual({ score: 0, reasons: [] });
  });

  it("rewards phone, budget, asap timeline and consults", () => {
    const { score, reasons } = scoreLead(
      { phone: "555", budget_range: "500_plus", timeline: "asap", primary_goal: "lose_fat" },
      { consultBooked: true },
    );
    expect(score).toBe(10 + 15 + 20 + 5 + 25);
    expect(reasons.map((r) => r.label)).toContain("Wants to start ASAP");
  });

  it("counts engagement and caps repeats", () => {
    const base = scoreLead({}, { downloadedMagnet: true, captures: 10, sentMessage: true });
    expect(base.score).toBe(10 + 10 + 15);
  });

  it("penalises unsubscribes and lost leads but never goes negative", () => {
    expect(scoreLead({ marketing_consent: true, unsubscribed_at: "2026-01-01" }).score).toBe(0);
    expect(scoreLead({ phone: "1", status: "lost" }).score).toBe(0);
  });

  it("clamps to 100", () => {
    const r = scoreLead(
      { phone: "1", primary_goal: "x", goal_details: "y", experience_level: "beginner", preferred_format: "in_person", budget_range: "500_plus", timeline: "asap", marketing_consent: true },
      { downloadedMagnet: true, consultBooked: true, sentMessage: true, captures: 5 },
    );
    expect(r.score).toBe(100);
  });

  it("buckets tiers", () => {
    expect(scoreTier(60)).toBe("hot");
    expect(scoreTier(30)).toBe("warm");
    expect(scoreTier(5)).toBe("cold");
  });
});
