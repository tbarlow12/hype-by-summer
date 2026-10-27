import { describe, expect, it } from "vitest";
import { attributionFromCookie } from "@/lib/attribution";
import { serializeAttrCookie } from "./attribution-cookie";

describe("attributionFromCookie", () => {
  it("maps first and last touch", () => {
    const raw = serializeAttrCookie({
      v: 1,
      ft: { utm_source: "ig", landing_page: "/free/x", referrer: "https://instagram.com/", ts: "2026-10-01T00:00:00.000Z" },
      lt: { utm_source: "google", utm_campaign: "fall", ts: "2026-10-20T00:00:00.000Z" },
    });
    expect(attributionFromCookie(raw)).toEqual({
      utmSource: "ig",
      landingPage: "/free/x",
      referrerUrl: "https://instagram.com/",
      firstSeenAt: "2026-10-01T00:00:00.000Z",
      utmMedium: undefined,
      utmCampaign: undefined,
      utmTerm: undefined,
      utmContent: undefined,
      lastTouch: {
        utmSource: "google",
        utmCampaign: "fall",
        at: "2026-10-20T00:00:00.000Z",
        utmMedium: undefined,
        utmTerm: undefined,
        utmContent: undefined,
        referrerUrl: undefined,
        landingPage: undefined,
      },
    });
  });

  it("returns {} for missing or broken cookies", () => {
    expect(attributionFromCookie(undefined)).toEqual({});
    expect(attributionFromCookie("garbage")).toEqual({});
  });
});
