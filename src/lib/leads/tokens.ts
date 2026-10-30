import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring download links for lead magnets:
// base64url("business:lead:magnet:exp").sig where sig = HMAC-SHA256(secret, "dl2|" + payload).
// The business is part of the claims so a link only works on the site of the
// business that issued it. Pure (secret passed in).

export type DownloadClaims = { businessId: string; leadId: string; magnetId: string; exp: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(`dl2|${payload}`).digest("base64url");

export function signDownloadToken(claims: DownloadClaims, secret: string): string {
  if (!secret) throw new Error("Missing token secret");
  const payload = b64(`${claims.businessId}:${claims.leadId}:${claims.magnetId}:${Math.floor(claims.exp)}`);
  return `${payload}.${sign(payload, secret)}`;
}

export type VerifyResult = { ok: true; claims: DownloadClaims } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyDownloadToken(token: string | null | undefined, secret: string, now = Date.now()): VerifyResult {
  if (!token || !secret || token.length > 400) return { ok: false, reason: "malformed" };
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  const [businessId, leadId, magnetId, expRaw, more] = Buffer.from(payload, "base64url").toString("utf8").split(":");
  const exp = Number(expRaw);
  const ids = [businessId, leadId, magnetId];
  if (more !== undefined || !ids.every((id) => id && UUID.test(id)) || !expRaw || !Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, claims: { businessId: businessId!, leadId: leadId!, magnetId: magnetId!, exp } };
}

/** Expiry timestamp (seconds) `days` from now. */
export const expiresInDays = (days: number, now = Date.now()) => Math.floor(now / 1000) + days * 86400;
