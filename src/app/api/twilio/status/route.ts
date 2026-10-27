import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifiedTwilioParams } from "@/lib/twilio-webhook";

export const runtime = "nodejs";

// Delivery status callbacks for messages sent by sendSms().
export async function POST(req: NextRequest) {
  const params = await verifiedTwilioParams(req, "/api/twilio/status");
  if (!params) return new Response("invalid signature", { status: 403 });
  const sid = params.MessageSid;
  if (sid) {
    await createAdminClient()
      .from("sms_messages")
      .update({ status: params.MessageStatus ?? "unknown", error: params.ErrorCode ? `twilio ${params.ErrorCode}` : null })
      .eq("twilio_sid", sid);
  }
  return new Response(null, { status: 204 });
}
