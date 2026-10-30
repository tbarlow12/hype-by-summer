import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyInbound, toE164 } from "@/lib/sms-utils";
import { twiml, verifiedTwilioParams } from "@/lib/twilio-webhook";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

// Configure in Twilio: Phone number → Messaging → "A message comes in" → POST <platform URL>/api/twilio/inbound
export async function POST(req: NextRequest) {
  const params = await verifiedTwilioParams(req, "/api/twilio/inbound");
  if (!params) return new Response("invalid signature", { status: 403 });

  const from = toE164(params.From);
  if (!from) return twiml();
  const admin = createAdminClient();
  const kind = classifyInbound(params.Body ?? "");

  if (kind === "stop") {
    await admin.from("sms_opt_outs").upsert({ phone: from });
    await admin.from("profiles").update({ sms_opt_in: false }).in("phone", [...new Set([params.From, from].filter(Boolean))]);
    return twiml(); // Twilio's Advanced Opt-Out sends the carrier-required confirmation.
  }
  if (kind === "start") {
    await admin.from("sms_opt_outs").delete().eq("phone", from);
    return twiml();
  }
  if (kind === "help") {
    // One number serves every business, so HELP stays brand-neutral.
    return twiml("Session reminders from your trainer. Reply STOP to opt out. Questions? Message your coach in the app.");
  }

  // Anything else: forward to the managers of the business that last texted
  // this number, so replies aren't lost.
  const { data: last } = await admin
    .from("sms_messages")
    .select("business_id")
    .eq("to_phone", from)
    .not("business_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last?.business_id) return twiml();
  const { data: managers } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", last.business_id)
    .eq("active", true)
    .in("role", ["owner", "admin"]);
  for (const m of managers ?? []) {
    await notify({ userId: m.user_id, businessId: last.business_id, type: "sms_reply", title: `Text from ${from}`, body: params.Body?.slice(0, 500) });
  }
  return twiml();
}
