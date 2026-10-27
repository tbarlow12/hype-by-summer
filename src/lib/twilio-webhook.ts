import "server-only";
import type { NextRequest } from "next/server";
import { absoluteUrl } from "@/lib/env";
import { isValidTwilioSignature } from "@/lib/sms-utils";
import { twilioConfig } from "@/lib/sms";

/** Parse + verify a Twilio webhook (form-encoded POST). Returns params, or null if forged. */
export async function verifiedTwilioParams(req: NextRequest, path: string): Promise<Record<string, string> | null> {
  const cfg = twilioConfig();
  if (!cfg) return null;
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  // Twilio signs the public URL it called; behind proxies that's our configured site URL.
  const url = absoluteUrl(path + req.nextUrl.search);
  return isValidTwilioSignature(cfg.token, req.headers.get("x-twilio-signature"), url, params) ? params : null;
}

export function twiml(message?: string): Response {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = message ? `<Response><Message>${esc(message)}</Message></Response>` : "<Response/>";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });
}
