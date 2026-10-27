import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRAND_NAME } from "@/lib/env";
import { classifyInbound, toE164 } from "@/lib/sms-utils";
import { twiml, verifiedTwilioParams } from "@/lib/twilio-webhook";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

// Configure in Twilio: Phone number → Messaging → "A message comes in" → POST {SITE_URL}/api/twilio/inbound
export async function POST(req: NextRequest) {
  const params = await verifiedTwilioParams(req, "/api/twilio/inbound");
  if (!params) return new Response("invalid signature", { status: 403 });

  const from = toE164(params.From);
  if (!from) return twiml();
  const admin = createAdminClient();
  const kind = classifyInbound(params.Body ?? "");

  if (kind === "stop") {
    await admin.from("sms_opt_outs").upsert({ phone: from });
    await admin.from("profiles").update({ sms_opt_in: false }).eq("phone", params.From);
    return twiml(); // Twilio's Advanced Opt-Out sends the carrier-required confirmation.
  }
  if (kind === "start") {
    await admin.from("sms_opt_outs").delete().eq("phone", from);
    return twiml();
  }
  if (kind === "help") {
    return twiml(`${BRAND_NAME}: session reminders. Reply STOP to opt out. Questions? Message your coach in the app.`);
  }

  // Anything else: forward to the trainer so replies aren't lost.
  const { data: trainers } = await admin.from("profiles").select("id").in("role", ["trainer", "admin"]);
  for (const t of trainers ?? []) {
    await notify({ userId: t.id, type: "sms_reply", title: `Text from ${from}`, body: params.Body?.slice(0, 500) });
  }
  return twiml();
}
