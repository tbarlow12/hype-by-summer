import "server-only";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { renderEmail, type EmailInput } from "@/lib/email";
import { serverEnv } from "@/lib/env.server";
import type { Brand } from "@/lib/tenant";
import { sendSms } from "@/lib/sms";
import { broadcastEmail, unsubscribeHeaders } from "@/lib/emails/broadcast";

export const AUDIENCES = ["active_clients", "all_clients", "leads", "subscribers"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CHANNELS = ["in_app", "email", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  active_clients: "Active clients",
  all_clients: "All clients (incl. paused & invited)",
  leads: "Leads who opted in to marketing",
  subscribers: "Clients with an active subscription",
};

type ClientRecipient = { kind: "client"; profileId: string; email: string; name: string | null; phone: string | null; smsOptIn: boolean };
type LeadRecipient = { kind: "lead"; leadId: string; email: string; name: string | null; unsubscribeToken: string };
export type Recipient = ClientRecipient | LeadRecipient;

/**
 * Resolve who a broadcast reaches within one business (RLS client; the caller
 * is a manager of `businessId`). Leads only with marketing consent and not
 * unsubscribed.
 */
export async function resolveAudience(businessId: string, audience: Audience): Promise<Recipient[]> {
  const supabase = await createClient();
  if (audience === "leads") {
    const { data } = await supabase
      .from("leads")
      .select("id, email, first_name, unsubscribe_token")
      .eq("business_id", businessId)
      .eq("marketing_consent", true)
      .is("unsubscribed_at", null)
      .limit(10000);
    return (data ?? []).map((l) => ({
      kind: "lead" as const,
      leadId: l.id,
      email: l.email,
      name: l.first_name,
      unsubscribeToken: l.unsubscribe_token,
    }));
  }

  let clientIds: string[];
  if (audience === "subscribers") {
    const { data } = await supabase
      .from("subscriptions")
      .select("client_id")
      .eq("business_id", businessId)
      .in("status", ["active", "trialing", "past_due"]);
    clientIds = [...new Set((data ?? []).map((s) => s.client_id))];
  } else {
    let q = supabase.from("business_clients").select("client_id").eq("business_id", businessId);
    q = audience === "active_clients" ? q.eq("status", "active") : q.neq("status", "archived");
    const { data } = await q;
    clientIds = (data ?? []).map((r) => r.client_id);
  }
  if (!clientIds.length) return [];

  const out: ClientRecipient[] = [];
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, phone, sms_opt_in")
      .in("id", clientIds.slice(i, i + 200));
    for (const p of data ?? []) {
      out.push({ kind: "client", profileId: p.id, email: p.email, name: p.full_name, phone: p.phone, smsOptIn: p.sms_opt_in });
    }
  }
  return out;
}

export function audienceCounts(recipients: Recipient[]) {
  const clients = recipients.filter((r): r is ClientRecipient => r.kind === "client");
  return {
    total: recipients.length,
    inApp: clients.length,
    email: recipients.filter((r) => Boolean(r.email)).length,
    sms: clients.filter((c) => c.smsOptIn && Boolean(c.phone)).length,
  };
}

/** Send many emails with Resend's batch API (100 per call); logs in dev. */
type BatchEmail = EmailInput & { headers?: Record<string, string> };

async function sendEmailBatch(brand: Brand, emails: BatchEmail[]): Promise<{ sent: number; failed: number }> {
  const key = serverEnv.resendApiKey();
  let sent = 0;
  let failed = 0;
  const rendered = emails.map((e) => {
    const { html, text } = renderEmail(e);
    // Make the unsubscribe URL in the (escaped) footer clickable.
    const unsub = e.footerNote?.match(/https?:\/\/\S+\/unsubscribe\/\S+/)?.[0];
    return {
      input: e,
      html: unsub ? html.replace(unsub, `<a href="${unsub}" style="color:#71717a">Unsubscribe</a>`) : html,
      text,
    };
  });
  if (!key) {
    for (const r of rendered) console.info(`[email:dev] to=${String(r.input.to)} subject="${r.input.subject}"`);
    return { sent: rendered.length, failed: 0 };
  }
  const resend = new Resend(key);
  for (let i = 0; i < rendered.length; i += 100) {
    const chunk = rendered.slice(i, i + 100);
    try {
      const { error } = await resend.batch.send(
        chunk.map((r) => ({
          from: `${brand.name.replace(/["<>]/g, "")} <${serverEnv.emailFromAddress()}>`,
          to: r.input.to,
          subject: r.input.subject,
          html: r.html,
          text: r.text,
          replyTo: r.input.replyTo ?? brand.replyTo ?? undefined,
          headers: r.input.headers,
        })),
      );
      if (error) {
        console.error("[broadcast] batch failed", error);
        failed += chunk.length;
      } else sent += chunk.length;
    } catch (err) {
      console.error("[broadcast] batch failed", err);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

/** Deliver a broadcast on the chosen channels (branded as the business). Returns delivery counts. */
export async function deliverBroadcast(input: {
  broadcastId: string;
  brand: Brand & { businessId: string };
  senderName: string;
  replyTo: string | null;
  subject: string;
  body: string;
  smsBody: string;
  channels: Channel[];
  recipients: Recipient[];
}) {
  const businessId = input.brand.businessId;
  const admin = createAdminClient();
  const clients = input.recipients.filter((r): r is ClientRecipient => r.kind === "client");
  let inApp = 0;

  if (input.channels.includes("in_app") && clients.length) {
    const preview = input.body.length > 200 ? `${input.body.slice(0, 197)}…` : input.body;
    for (let i = 0; i < clients.length; i += 500) {
      const rows = clients.slice(i, i + 500).map((c) => ({
        user_id: c.profileId,
        business_id: businessId,
        type: "broadcast",
        title: input.subject,
        body: preview,
        link: "/me/messages",
      }));
      const { error } = await admin.from("notifications").insert(rows);
      if (error) console.error("[broadcast] notifications failed", error);
      else inApp += rows.length;
    }
  }

  let emails = { sent: 0, failed: 0 };
  if (input.channels.includes("email")) {
    const seen = new Set<string>();
    const batch: BatchEmail[] = [];
    for (const r of input.recipients) {
      const email = r.email?.toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const e = broadcastEmail({
        brand: input.brand,
        to: r.email,
        subject: input.subject,
        body: input.body,
        senderName: input.senderName,
        firstName: r.name,
        unsubscribeToken: r.kind === "lead" ? r.unsubscribeToken : null,
        replyTo: input.replyTo ?? undefined,
      });
      const headers = r.kind === "lead" ? unsubscribeHeaders(input.brand, r.unsubscribeToken) : undefined;
      batch.push({ ...e, headers });
    }
    emails = await sendEmailBatch(input.brand, batch);
  }

  let sms = 0;
  if (input.channels.includes("sms")) {
    // Clients only, and only those who opted in to texts. Never leads.
    const targets = clients.filter((c) => c.smsOptIn && c.phone);
    for (let i = 0; i < targets.length; i += 5) {
      const results = await Promise.all(
        targets.slice(i, i + 5).map((c) => sendSms({ brand: input.brand, to: c.phone, body: input.smsBody, kind: "other", profileId: c.profileId })),
      );
      sms += results.filter((r) => r.ok).length;
    }
  }

  await admin
    .from("broadcasts")
    .update({ sent_at: new Date().toISOString(), emails_sent: emails.sent, emails_failed: emails.failed, sms_sent: sms })
    .eq("id", input.broadcastId)
    .eq("business_id", businessId);

  return { inApp, emailsSent: emails.sent, emailsFailed: emails.failed, sms };
}
