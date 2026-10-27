import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { absoluteUrl, BRAND_NAME } from "@/lib/env";
import { toE164, withOptOut } from "@/lib/sms-utils";

export type SmsKind = "reminder" | "confirmation" | "cancellation" | "other";

type TwilioConfig = { sid: string; token: string; from?: string; messagingServiceSid?: string };

export function twilioConfig(): TwilioConfig | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER || undefined;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || undefined;
  if (!sid || !token || (!from && !messagingServiceSid)) return null;
  return { sid, token, from, messagingServiceSid };
}

export const isSmsConfigured = () => twilioConfig() !== null;

/**
 * Send an SMS via Twilio. The caller is responsible for consent (profile
 * sms_opt_in or booking sms_opt_in); this enforces STOP opt-outs, logs every
 * attempt to sms_messages, and never throws. Without Twilio env vars it logs
 * to the console (local dev).
 */
export async function sendSms(input: {
  to: string | null | undefined;
  body: string;
  kind: SmsKind;
  profileId?: string | null;
  bookingId?: string | null;
}): Promise<{ ok: boolean; skipped?: string }> {
  const to = toE164(input.to);
  if (!to) return { ok: false, skipped: "invalid_phone" };
  const admin = createAdminClient();
  const body = withOptOut(input.body, BRAND_NAME);

  const { data: optOut } = await admin.from("sms_opt_outs").select("phone").eq("phone", to).maybeSingle();
  if (optOut) return { ok: false, skipped: "opted_out" };

  const { data: log } = await admin
    .from("sms_messages")
    .insert({ to_phone: to, body, kind: input.kind, profile_id: input.profileId ?? null, booking_id: input.bookingId ?? null })
    .select("id")
    .single();

  const cfg = twilioConfig();
  if (!cfg) {
    console.info(`[sms:dev] to=${to} ${body}`);
    if (log) await admin.from("sms_messages").update({ status: "skipped", error: "twilio_not_configured" }).eq("id", log.id);
    return { ok: true, skipped: "not_configured" };
  }

  try {
    const form = new URLSearchParams({ To: to, Body: body, StatusCallback: absoluteUrl("/api/twilio/status") });
    if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
    else form.set("From", cfg.from!);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const json = (await res.json()) as { sid?: string; status?: string; message?: string; code?: number };
    if (!res.ok) {
      // 21610: recipient previously replied STOP to this sender.
      if (json.code === 21610) await admin.from("sms_opt_outs").upsert({ phone: to });
      if (log) await admin.from("sms_messages").update({ status: "failed", error: `${json.code}: ${json.message}` }).eq("id", log.id);
      return { ok: false };
    }
    if (log) await admin.from("sms_messages").update({ status: json.status ?? "sent", twilio_sid: json.sid ?? null }).eq("id", log.id);
    return { ok: true };
  } catch (err) {
    console.error("[sms] send failed", err);
    if (log) await admin.from("sms_messages").update({ status: "failed", error: String(err) }).eq("id", log.id);
    return { ok: false };
  }
}

/**
 * Phone + consent for a booking's attendee: a signed-in client's profile
 * (sms_opt_in + phone) or the guest's phone with per-booking consent.
 */
export async function smsTargetForBooking(bookingId: string): Promise<{ phone: string; profileId: string | null } | null> {
  const admin = createAdminClient();
  const { data: b } = await admin
    .from("bookings")
    .select("client_id, guest_phone, sms_opt_in, profiles!bookings_client_id_fkey(phone, sms_opt_in)")
    .eq("id", bookingId)
    .single();
  if (!b) return null;
  const p = b.profiles;
  if (p?.sms_opt_in && p.phone) return { phone: p.phone, profileId: b.client_id };
  if (b.sms_opt_in && (p?.phone || b.guest_phone)) return { phone: (p?.phone || b.guest_phone)!, profileId: b.client_id };
  return null;
}
