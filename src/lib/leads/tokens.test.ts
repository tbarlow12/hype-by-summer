import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expiresInDays, signDownloadToken, verifyDownloadToken } from "./tokens";

const businessId = "33333333-3333-4333-8333-333333333333";
const leadId = "11111111-1111-4111-8111-111111111111";
const magnetId = "22222222-2222-4222-8222-222222222222";
const secret = "test-secret";

describe("download tokens", () => {
  it("round-trips with the issuing business", () => {
    const exp = expiresInDays(30);
    const token = signDownloadToken({ businessId, leadId, magnetId, exp }, secret);
    expect(verifyDownloadToken(token, secret)).toEqual({ ok: true, claims: { businessId, leadId, magnetId, exp } });
  });

  it("rejects tampering, other secrets and expiry", () => {
    const token = signDownloadToken({ businessId, leadId, magnetId, exp: expiresInDays(1) }, secret);
    expect(verifyDownloadToken(token, "other")).toEqual({ ok: false, reason: "bad_signature" });
    // Swapping the business (or any id) breaks the signature.
    const otherBusiness = `${Buffer.from(`${leadId}:${leadId}:${magnetId}:9999999999`).toString("base64url")}.${token.split(".")[1]}`;
    expect(verifyDownloadToken(otherBusiness, secret)).toEqual({ ok: false, reason: "bad_signature" });
    const old = signDownloadToken({ businessId, leadId, magnetId, exp: 1000 }, secret);
    expect(verifyDownloadToken(old, secret)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects old-format (business-less) and malformed tokens", () => {
    const payload = Buffer.from(`${leadId}:${magnetId}:9999999999`).toString("base64url");
    const legacy = `${payload}.${createHmac("sha256", secret).update(`dl2|${payload}`).digest("base64url")}`;
    expect(verifyDownloadToken(legacy, secret)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyDownloadToken("", secret).ok).toBe(false);
    expect(verifyDownloadToken("abc", secret).ok).toBe(false);
    expect(verifyDownloadToken("a.b.c", secret).ok).toBe(false);
    expect(verifyDownloadToken(null, secret).ok).toBe(false);
  });
});
