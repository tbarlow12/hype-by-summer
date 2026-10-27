import { describe, expect, it } from "vitest";
import { classifyInbound, computeTwilioSignature, isValidTwilioSignature, toE164, withOptOut } from "./sms-utils";

describe("toE164", () => {
  it("normalises US numbers", () => {
    expect(toE164("(303) 555-0142")).toBe("+13035550142");
    expect(toE164("1-303-555-0142")).toBe("+13035550142");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk", () => {
    expect(toE164("555-0142")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("classifyInbound", () => {
  it("recognises carrier keywords", () => {
    expect(classifyInbound(" STOP ")).toBe("stop");
    expect(classifyInbound("Unsubscribe")).toBe("stop");
    expect(classifyInbound("start")).toBe("start");
    expect(classifyInbound("HELP")).toBe("help");
    expect(classifyInbound("see you at 6!")).toBe("other");
  });
});

describe("twilio signature", () => {
  // Example from Twilio's security docs.
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  it("matches the documented example", () => {
    expect(computeTwilioSignature(token, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });
  it("validates and rejects", () => {
    expect(isValidTwilioSignature(token, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", url, params)).toBe(true);
    expect(isValidTwilioSignature(token, "nope", url, params)).toBe(false);
    expect(isValidTwilioSignature(token, null, url, params)).toBe(false);
  });
});

describe("withOptOut", () => {
  it("prefixes brand and appends opt-out", () => {
    expect(withOptOut("See you tomorrow at 6:00 AM.", "Hype")).toBe("Hype: See you tomorrow at 6:00 AM. Reply STOP to opt out.");
  });
  it("truncates long bodies", () => {
    expect(withOptOut("x".repeat(1000), "Hype").length).toBeLessThanOrEqual(300);
  });
});
