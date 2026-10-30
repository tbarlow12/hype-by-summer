import { describe, expect, it } from "vitest";
import { dueWindow, filtersToQuery, ownerScope, parseLeadFilters } from "./filters";

describe("lead filters", () => {
  it("parses valid values and drops invalid ones", () => {
    const f = parseLeadFilters({ status: "new", source: "nope", magnet: "x", q: "amy@x.com),or(", sort: "score", due: "overdue" });
    expect(f).toEqual({ status: "new", source: undefined, magnet: undefined, campaign: undefined, due: "overdue", q: "amy@x.comor", owner: undefined, sort: "score" });
  });

  it("defaults sort and serialises back", () => {
    const f = parseLeadFilters(new URLSearchParams("campaign=fall"));
    expect(f.sort).toBe("newest");
    expect(filtersToQuery(f)).toBe("?campaign=fall");
    expect(filtersToQuery({ sort: "newest" })).toBe("");
  });

  it("computes due windows", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(dueWindow("overdue", now)).toEqual({ before: now.toISOString() });
    expect(dueWindow("today", now)).toEqual({ before: "2026-10-27T23:59:59.999Z" });
    expect(dueWindow("none", now)).toEqual({ none: true });
  });

  it("scopes by owner: explicit choice, else coaches mine and managers all", () => {
    expect(parseLeadFilters({ owner: "unassigned" }).owner).toBe("unassigned");
    expect(parseLeadFilters({ owner: "boss" }).owner).toBeUndefined();
    expect(ownerScope({}, false)).toBe("mine");
    expect(ownerScope({}, true)).toBe("all");
    expect(ownerScope({ owner: "all" }, false)).toBe("all");
    expect(filtersToQuery({ owner: "all", sort: "newest" })).toBe("?owner=all");
  });
});
