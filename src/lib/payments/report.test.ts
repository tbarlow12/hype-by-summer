import { describe, expect, it } from "vitest";
import { commissionCsv, commissionLines, commissionTotals, csvField, parseDateRange } from "./report";

const now = new Date("2026-10-27T12:00:00Z");

describe("parseDateRange", () => {
  it("defaults to the current month to date in the business's timezone", () => {
    const r = parseDateRange({}, "America/Denver", now);
    expect(r.from).toBe("2026-10-01");
    expect(r.to).toBe("2026-10-27");
    expect(r.fromUtc.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(r.toUtc.toISOString()).toBe("2026-10-28T06:00:00.000Z");
  });
  it("is inclusive of the end day across a DST change", () => {
    const r = parseDateRange({ from: "2026-11-01", to: "2026-11-01" }, "America/Denver", now);
    expect(r.fromUtc.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(r.toUtc.toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });
  it("swaps reversed ranges and ignores junk", () => {
    expect(parseDateRange({ from: "2026-10-10", to: "2026-10-01" }, "UTC", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
    expect(parseDateRange({ from: "nope", to: "2026-13-45" }, "UTC", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-27" });
  });
  it("caps very long ranges", () => {
    const r = parseDateRange({ from: "2000-01-01", to: "2026-10-27" }, "UTC", now);
    expect(r.from > "2023-01-01").toBe(true);
  });
});

describe("commission lines", () => {
  const rows = [
    { coach_id: null, payments: 1, gross_cents: 1000, refunded_cents: 0, net_cents: 1000, platform_fee_cents: 30 },
    { coach_id: "c1", payments: 2, gross_cents: 15000, refunded_cents: 4000, net_cents: 11000, platform_fee_cents: 450 },
    { coach_id: "c2", payments: 1, gross_cents: 20000, refunded_cents: 0, net_cents: 20000, platform_fee_cents: 600 },
    { coach_id: "gone", payments: 1, gross_cents: 8000, refunded_cents: 0, net_cents: 8000, platform_fee_cents: 0 },
  ];
  const names = new Map([["c1", "Ana"], ["c2", "Ben"]]);

  it("sorts by net revenue with unassigned last and computes shares", () => {
    const lines = commissionLines(rows, names);
    expect(lines.map((l) => l.coachName)).toEqual(["Ben", "Ana", "Former coach", "Unassigned"]);
    expect(lines[0]).toMatchObject({ netCents: 20000, keptCents: 19400, share: 0.5 });
    expect(lines[1]).toMatchObject({ grossCents: 15000, refundedCents: 4000, netCents: 11000, platformFeeCents: 450, keptCents: 10550 });
    expect(commissionTotals(lines)).toEqual({ payments: 5, grossCents: 44000, refundedCents: 4000, netCents: 40000, platformFeeCents: 1080, keptCents: 38920 });
  });
  it("handles an empty report", () => {
    expect(commissionLines([], names)).toEqual([]);
    expect(commissionTotals([])).toMatchObject({ netCents: 0 });
  });
  it("exports CSV with a total row", () => {
    const csv = commissionCsv(commissionLines(rows, names), { from: "2026-10-01", to: "2026-10-31" });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Coach,From,To,Currency,Payments,Gross,Refunded,Net,Platform fees,Net after fees,Share %");
    expect(lines[1]).toBe("Ben,2026-10-01,2026-10-31,USD,1,200.00,0.00,200.00,6.00,194.00,50.0");
    expect(lines.at(-1)).toBe("Total,2026-10-01,2026-10-31,USD,5,440.00,40.00,400.00,10.80,389.20,100.0");
  });
  it("escapes CSV fields and neutralises formulas", () => {
    expect(csvField('Ana "The Coach", PT')).toBe('"Ana ""The Coach"", PT"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-12.50")).toBe("-12.50");
    expect(csvField(42)).toBe("42");
  });
});
