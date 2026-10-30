import { describe, expect, it } from "vitest";
import { mergeVisit, parseAttrCookie, serializeAttrCookie, touchFromVisit } from "./attribution-cookie";

const now = new Date("2026-10-27T12:00:00Z");

describe("attribution cookie", () => {
  it("builds a touch from UTM params and an external referrer", () => {
    const t = touchFromVisit("https://studio.example.com/free/guide?utm_source=IG&utm_campaign=fall&x=1", "https://instagram.com/p/abc?x=y", now);
    expect(t).toEqual({
      utm_source: "IG",
      utm_campaign: "fall",
      referrer: "https://instagram.com/p/abc",
      landing_page: "/free/guide?utm_source=IG&utm_campaign=fall&x=1",
      ts: now.toISOString(),
    });
  });

  it("ignores same-site referrers", () => {
    expect(touchFromVisit("https://studio.example.com/", "https://studio.example.com/free", now).referrer).toBeUndefined();
  });

  it("never overwrites first touch and only moves last touch for campaign visits", () => {
    const first = mergeVisit(null, touchFromVisit("https://studio.example.com/?utm_source=ig", "", now))!;
    expect(first.ft.utm_source).toBe("ig");
    expect(first.lt?.utm_source).toBe("ig");
    expect(mergeVisit(first, touchFromVisit("https://studio.example.com/pricing", "", now))).toBeNull();
    const second = mergeVisit(first, touchFromVisit("https://studio.example.com/?utm_source=google", "", now))!;
    expect(second.ft.utm_source).toBe("ig");
    expect(second.lt?.utm_source).toBe("google");
  });

  it("direct first visit has no last touch", () => {
    expect(mergeVisit(null, touchFromVisit("https://studio.example.com/", "", now))).toEqual({
      v: 1,
      ft: { landing_page: "/", ts: now.toISOString() },
    });
  });

  it("round-trips and rejects junk safely", () => {
    const c = { v: 1 as const, ft: { utm_source: "a", ts: now.toISOString() } };
    expect(parseAttrCookie(serializeAttrCookie(c))).toEqual(c);
    expect(parseAttrCookie("%7Bnot json")).toBeNull();
    expect(parseAttrCookie(undefined)).toBeNull();
    expect(parseAttrCookie(JSON.stringify({ ft: { utm_source: 42 } }))).toBeNull();
    const long = parseAttrCookie(JSON.stringify({ ft: { utm_source: "x".repeat(1000), ts: "nope", evil: "1" } }));
    expect(long?.ft.utm_source).toHaveLength(300);
    expect(long?.ft).not.toHaveProperty("ts");
    expect(long?.ft).not.toHaveProperty("evil");
  });
});
