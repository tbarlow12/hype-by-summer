import { describe, expect, it } from "vitest";
import { expiresInDays, signDownloadToken, verifyDownloadToken } from "./tokens";

const leadId = "11111111-1111-4111-8111-111111111111";
const magnetId = "22222222-2222-4222-8222-222222222222";
const secret = "test-secret";

describe("download tokens", () => {
  it("round-trips", () => {
    const exp = expiresInDays(30);
    const token = signDownloadToken({ leadId, magnetId, exp }, secret);
    expect(verifyDownloadToken(token, secret)).toEqual({ ok: true, claims: { leadId, magnetId, exp } });
  });

  it("rejects tampering, other secrets and expiry", () => {
    const token = signDownloadToken({ leadId, magnetId, exp: expiresInDays(1) }, secret);
    expect(verifyDownloadToken(token, "other")).toEqual({ ok: false, reason: "bad_signature" });
    const forged = `${Buffer.from(`${leadId}:${leadId}:9999999999`).toString("base64url")}.${token.split(".")[1]}`;
    expect(verifyDownloadToken(forged, secret).ok).toBe(false);
    const old = signDownloadToken({ leadId, magnetId, exp: 1000 }, secret);
    expect(verifyDownloadToken(old, secret)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed input", () => {
    expect(verifyDownloadToken("", secret).ok).toBe(false);
    expect(verifyDownloadToken("abc", secret).ok).toBe(false);
    expect(verifyDownloadToken("a.b.c", secret).ok).toBe(false);
    expect(verifyDownloadToken(null, secret).ok).toBe(false);
  });
});
