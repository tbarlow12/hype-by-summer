import { describe, expect, it } from "vitest";
import { slugCandidates, slugify, slugProblem } from "./slug";

describe("slug rules", () => {
  it("slugifies business names", () => {
    expect(slugify("  Peak Performance & Fitness! ")).toBe("peak-performance-and-fitness");
    expect(slugify("Zoë's Studio")).toBe("zoes-studio");
    expect(slugify("---")).toBe("");
  });
  it("matches the database constraint and reserved words", () => {
    expect(slugProblem("ok-fit")).toBeNull();
    expect(slugProblem("a")).toMatch(/at least/);
    expect(slugProblem("-abc")).toMatch(/lowercase/);
    expect(slugProblem("Abc")).toMatch(/lowercase/);
    expect(slugProblem("admin")).toMatch(/reserved/);
    expect(slugProblem("pricing")).toMatch(/reserved/);
    expect(slugProblem("a--b")).toMatch(/double/);
    expect(slugProblem("x".repeat(42))).toMatch(/at most/);
  });
  it("suggests valid alternatives", () => {
    const s = slugCandidates("Admin");
    expect(s).not.toContain("admin");
    expect(s[0]).toBe("admin-fit");
    expect(s.every((x) => slugProblem(x) === null)).toBe(true);
    expect(slugCandidates("")[0]).toBe("coach-fit");
  });
});
