import { describe, expect, it } from "vitest";
import { buildUtmUrl } from "./utm";

describe("buildUtmUrl", () => {
  it("adds normalized params and drops empty ones", () => {
    expect(buildUtmUrl("https://x.com/free/g?utm_term=old", { source: "Instagram", medium: "social", campaign: "Summer Shred 2026!" })).toBe(
      "https://x.com/free/g?utm_source=instagram&utm_medium=social&utm_campaign=summer-shred-2026",
    );
  });
});
