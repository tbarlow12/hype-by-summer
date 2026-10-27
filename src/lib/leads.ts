import "server-only";
import { headers } from "next/headers";
import type { Tables, Enums, Json } from "@/lib/supabase/database.types";
import { readAttribution, type Attribution } from "@/lib/attribution";
import { createAdminClient } from "@/lib/supabase/admin";
import { absoluteUrl, BRAND_NAME } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { clientInfoFromHeaders } from "@/lib/leads/headers";
import { scoreLead } from "@/lib/leads/score";
import { expiresInDays, signDownloadToken, verifyDownloadToken, type VerifyResult } from "@/lib/leads/tokens";

// OWNER: leads. Contract used by scheduling (consult bookings), homepage forms.

export type CaptureLeadInput = {
  trainerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  source: "lead_magnet" | "booking" | "contact_form" | "referral" | "manual" | "import";
  leadMagnetId?: string;
  primaryGoal?: string;
  goalDetails?: string;
  experienceLevel?: string;
  preferredFormat?: string;
  budgetRange?: string;
  timeline?: string;
  zipCode?: string;
  city?: string;
  injuriesOrLimitations?: string;
  howHeard?: string;
  marketingConsent?: boolean;
  consentText?: string;
  /** Defaults to the visitor's `hbs_attr` cookie when omitted. */
  attribution?: Attribution;
  ipAddress?: string;
  userAgent?: string;
  country?: string;
};

export type Lead = Tables<"leads">;

const clean = (v: string | undefined | null, max = 2000) => {
  const s = v?.trim();
  return s ? s.slice(0, max) : undefined;
};

async function requestInfo() {
  try {
    return clientInfoFromHeaders(await headers());
  } catch {
    return {}; // called outside a request (scripts, cron)
  }
}

/** Upserts a lead (merging repeat submissions) and logs a `captured` event. */
export async function captureLead(input: CaptureLeadInput): Promise<Tables<"leads">> {
  const email = clean(input.email, 320)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");

  let attribution = input.attribution;
  if (!attribution) {
    try {
      attribution = await readAttribution();
    } catch {
      attribution = {};
    }
  }
  const info = await requestInfo();
  const last = attribution.lastTouch;
  const lastTouch = last
    ? Object.fromEntries(
        Object.entries({
          utm_source: last.utmSource,
          utm_medium: last.utmMedium,
          utm_campaign: last.utmCampaign,
          utm_term: last.utmTerm,
          utm_content: last.utmContent,
          referrer_url: last.referrerUrl,
          landing_page: last.landingPage,
          at: last.at,
        }).filter(([, v]) => v),
      )
    : undefined;

  const payload: Record<string, Json | undefined> = {
    trainer_id: input.trainerId,
    email,
    first_name: clean(input.firstName, 100),
    last_name: clean(input.lastName, 100),
    phone: clean(input.phone, 40),
    source: input.source,
    lead_magnet_id: input.leadMagnetId,
    primary_goal: clean(input.primaryGoal, 60),
    goal_details: clean(input.goalDetails, 5000),
    experience_level: clean(input.experienceLevel, 60),
    preferred_format: clean(input.preferredFormat, 60),
    budget_range: clean(input.budgetRange, 60),
    timeline: clean(input.timeline, 60),
    zip_code: clean(input.zipCode, 20),
    city: clean(input.city, 100),
    injuries_or_limitations: clean(input.injuriesOrLimitations, 2000),
    how_heard: clean(input.howHeard, 200),
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_term: attribution.utmTerm,
    utm_content: attribution.utmContent,
    referrer_url: attribution.referrerUrl,
    landing_page: attribution.landingPage,
    first_seen_at: attribution.firstSeenAt,
    last_touch: lastTouch && Object.keys(lastTouch).length ? lastTouch : undefined,
    ip_address: input.ipAddress ?? info.ipAddress,
    user_agent: input.userAgent ?? info.userAgent,
    country: input.country ?? info.country,
    marketing_consent: input.marketingConsent ?? false,
    consent_text: input.marketingConsent ? clean(input.consentText, 1000) : undefined,
  };
  // jsonb_build: drop undefined keys so the RPC sees SQL nulls.
  const p = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as Json;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("capture_lead", { p });
  if (error || !data) throw new Error(`capture_lead failed: ${error?.message ?? "no data"}`);
  return (await refreshLeadScore(data.id)) ?? data;
}

/**
 * Recomputes `leads.score` from the lead's fields and engagement events.
 * Returns the updated lead (or null if it no longer exists).
 */
export async function refreshLeadScore(leadId: string): Promise<Lead | null> {
  const admin = createAdminClient();
  const [{ data: lead }, { data: events }, { count: consultBookings }] = await Promise.all([
    admin.from("leads").select("*").eq("id", leadId).maybeSingle(),
    admin.from("lead_events").select("type").eq("lead_id", leadId).in("type", ["captured", "magnet_downloaded", "consult_booked", "contact_message"]),
    admin.from("bookings").select("id, session_types!inner(is_consultation)", { count: "exact", head: true }).eq("lead_id", leadId).eq("session_types.is_consultation", true),
  ]);
  if (!lead) return null;
  const types = (events ?? []).map((e) => e.type);
  const { score } = scoreLead(lead, {
    captures: types.filter((t) => t === "captured").length,
    downloadedMagnet: types.includes("magnet_downloaded"),
    consultBooked: types.includes("consult_booked") || (consultBookings ?? 0) > 0,
    sentMessage: types.includes("contact_message"),
  });
  if (score === lead.score) return lead;
  const { data: updated } = await admin.from("leads").update({ score }).eq("id", leadId).select("*").single();
  return updated ?? { ...lead, score };
}

const SCORE_EVENTS = new Set<Enums<"lead_event_type">>(["magnet_downloaded", "consult_booked", "contact_message", "captured"]);

export async function recordLeadEvent(
  leadId: string,
  type: Enums<"lead_event_type">,
  detail?: Record<string, unknown>,
  createdBy?: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_events")
    .insert({ lead_id: leadId, type, detail: (detail ?? {}) as Json, created_by: createdBy ?? null });
  if (error) throw new Error(`recordLeadEvent failed: ${error.message}`);

  // Side effects that keep the pipeline in sync.
  const now = new Date().toISOString();
  if (type === "consult_booked") {
    await admin
      .from("leads")
      .update({ status: "consult_booked" })
      .eq("id", leadId)
      .in("status", ["new", "contacted", "nurturing", "lost"]);
  } else if (type === "email_sent") {
    await admin.from("leads").update({ last_contacted_at: now }).eq("id", leadId);
    await admin.from("leads").update({ status: "contacted" }).eq("id", leadId).eq("status", "new");
  }
  if (SCORE_EVENTS.has(type)) await refreshLeadScore(leadId);
}

// ---------------------------------------------------------------------------
// Lead magnet delivery
// ---------------------------------------------------------------------------

function tokenSecret(): string {
  const secret = process.env.LEAD_TOKEN_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing LEAD_TOKEN_SECRET (or SUPABASE_SECRET_KEY)");
  return secret;
}

/** Download links stay valid for 30 days (each click mints a 5-minute storage URL). */
export const DOWNLOAD_LINK_DAYS = 30;

export function createDownloadToken(leadId: string, magnetId: string): string {
  return signDownloadToken({ leadId, magnetId, exp: expiresInDays(DOWNLOAD_LINK_DAYS) }, tokenSecret());
}

export function verifyDownloadTokenValue(token: string | null | undefined): VerifyResult {
  return verifyDownloadToken(token, tokenSecret());
}

export const downloadUrl = (token: string) => absoluteUrl(`/api/lead-magnets/download?token=${encodeURIComponent(token)}`);
export const unsubscribeUrl = (lead: Pick<Lead, "unsubscribe_token">) => absoluteUrl(`/unsubscribe/${lead.unsubscribe_token}`);

/** Standard footer for any marketing/lead email. */
export function leadEmailFooter(lead: Pick<Lead, "unsubscribe_token">): string {
  return `Don't want these emails? Unsubscribe: ${unsubscribeUrl(lead)}`;
}

/**
 * Emails the guide's download link to the lead and logs `magnet_delivered`.
 * Returns the signed token (used for the instant download on the thank-you page).
 */
export async function deliverLeadMagnet(
  lead: Pick<Lead, "id" | "email" | "first_name" | "unsubscribe_token">,
  magnet: Pick<Tables<"lead_magnets">, "id" | "title" | "slug" | "thank_you_message">,
  opts: { bookUrl?: string; replyTo?: string } = {},
): Promise<{ token: string; emailed: boolean }> {
  const token = createDownloadToken(lead.id, magnet.id);
  const hi = lead.first_name ? `Hi ${lead.first_name},` : "Hi there,";
  const paragraphs = [
    hi,
    `Here's your copy of "${magnet.title}". Tap the button below to download it. The link works for ${DOWNLOAD_LINK_DAYS} days, so save the PDF somewhere handy.`,
  ];
  if (magnet.thank_you_message) paragraphs.push(magnet.thank_you_message);
  if (opts.bookUrl) {
    paragraphs.push(`Want a plan built around you? Book a free consult and we'll map out your first month together: ${opts.bookUrl}`);
  }
  paragraphs.push(`Just reply to this email if you have any questions.\n\n${BRAND_NAME}`);

  const result = await sendEmail({
    to: lead.email,
    subject: `Your free guide: ${magnet.title}`,
    heading: magnet.title,
    paragraphs,
    cta: { label: "Download your guide", url: downloadUrl(token) },
    footerNote: `You're receiving this because you requested this guide. ${leadEmailFooter(lead)}`,
    replyTo: opts.replyTo,
  });
  await recordLeadEvent(lead.id, "magnet_delivered", {
    lead_magnet_id: magnet.id,
    slug: magnet.slug,
    emailed: result.ok,
  });
  return { token, emailed: result.ok };
}
