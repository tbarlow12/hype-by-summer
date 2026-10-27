import { createHmac, timingSafeEqual } from "node:crypto";

/** Normalise a user-entered phone number to E.164 (US/Canada default). Null if unusable. */
export function toE164(raw: string | null | undefined, defaultCountryCode = "1"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return null;
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"]);
const START_WORDS = new Set(["start", "unstop", "yes", "optin"]);

/** Classify an inbound SMS body per carrier keyword rules. */
export function classifyInbound(body: string): "stop" | "start" | "help" | "other" {
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (word === "help" || word === "info") return "help";
  return "other";
}

/**
 * Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function isValidTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Keep messages to a couple of segments; always end with opt-out language. */
export function withOptOut(body: string, brand: string): string {
  const suffix = " Reply STOP to opt out.";
  const prefix = `${brand}: `;
  const max = 300 - suffix.length - prefix.length;
  const text = body.length > max ? `${body.slice(0, max - 1)}…` : body;
  return `${prefix}${text}${suffix}`;
}
