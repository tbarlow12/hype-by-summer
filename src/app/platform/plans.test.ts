import { describe, expect, it } from "vitest";
import { breakEvenCents, formatBps, formatDollars, monthlyCost, planPricing } from "./plans";

describe("plans", () => {
  it("defaults to 3% and $49", () => {
    expect(planPricing({})).toEqual({ starterFeeBps: 300, proMonthlyCents: 4900 });
  });
  it("reads env and ignores nonsense", () => {
    expect(planPricing({ PLATFORM_STARTER_FEE_BPS: "250", PLATFORM_PRO_PRICE_DOLLARS: "79.5" })).toEqual({
      starterFeeBps: 250,
      proMonthlyCents: 7950,
    });
    expect(planPricing({ PLATFORM_STARTER_FEE_BPS: "9999", PLATFORM_PRO_PRICE_DOLLARS: "abc" })).toEqual({
      starterFeeBps: 300,
      proMonthlyCents: 4900,
    });
  });
  it("formats", () => {
    expect(formatBps(300)).toBe("3%");
    expect(formatBps(250)).toBe("2.5%");
    expect(formatDollars(4900)).toBe("$49");
    expect(formatDollars(163300)).toBe("$1,633");
    expect(formatDollars(7950)).toBe("$79.50");
  });
  it("compares plans", () => {
    const p = { starterFeeBps: 300, proMonthlyCents: 4900 };
    expect(monthlyCost(100_000, p)).toEqual({ starter: 3000, pro: 4900 });
    expect(breakEvenCents(p)).toBe(163_334);
    expect(monthlyCost(breakEvenCents(p)!, p).starter).toBeGreaterThanOrEqual(4900);
    expect(breakEvenCents({ starterFeeBps: 0, proMonthlyCents: 4900 })).toBeNull();
  });
});
