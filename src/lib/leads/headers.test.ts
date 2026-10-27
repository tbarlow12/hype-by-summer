import { describe, expect, it } from "vitest";
import { clientInfoFromHeaders } from "./headers";

describe("clientInfoFromHeaders", () => {
  it("takes the first forwarded IP and vercel country", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "UA", "x-vercel-ip-country": "us" });
    expect(clientInfoFromHeaders(h)).toEqual({ ipAddress: "203.0.113.9", userAgent: "UA", country: "US" });
  });

  it("drops invalid values", () => {
    const h = new Headers({ "x-forwarded-for": "not-an-ip", "x-vercel-ip-country": "XYZ" });
    expect(clientInfoFromHeaders(h)).toEqual({ ipAddress: undefined, userAgent: undefined, country: undefined });
    expect(clientInfoFromHeaders(new Headers({ "x-forwarded-for": "999.1.1.1" })).ipAddress).toBeUndefined();
    expect(clientInfoFromHeaders(new Headers({ "x-forwarded-for": "2001:db8::1" })).ipAddress).toBe("2001:db8::1");
  });
});
