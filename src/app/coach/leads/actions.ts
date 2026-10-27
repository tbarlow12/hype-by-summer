"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { absoluteUrl } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { captureLead, leadEmailFooter, recordLeadEvent, refreshLeadScore } from "@/lib/leads";
import {
  BUDGETS,
  EXPERIENCE_LEVELS,
  FORMATS,
  GOALS,
  LEAD_SOURCES,
  LOST_REASONS,
  TIMELINES,
  values,
  type Option,
} from "@/lib/leads/options";

const optionalEnum = (opts: Option[]) =>
  z
    .union([z.literal(""), z.enum(values(opts))])
    .optional()
    .transform((v) => v || null);
const nullableText = (max: number) =>
  zfd
    .text()
    .pipe(z.string().max(max).optional())
    .transform((v) => v ?? null);

/** Loads a lead the signed-in trainer owns (RLS + explicit trainer filter). */
async function ownedLead(leadId: string) {
  const trainer = await requireTrainer();
  if (!z.uuid().safeParse(leadId).success) return { trainer, lead: null, supabase: null };
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).eq("trainer_id", trainer.id).maybeSingle();
  return { trainer, lead, supabase };
}

const refresh = (leadId?: string) => {
  revalidatePath("/coach/leads");
  if (leadId) revalidatePath(`/coach/leads/${leadId}`);
};

// ---------------------------------------------------------------------------
// Quick add
// ---------------------------------------------------------------------------
const createSchema = z.object({
  first_name: zfd.requiredText("First name is required").pipe(z.string().max(100)),
  last_name: zfd.text().pipe(z.string().max(100).optional()),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: zfd.text().pipe(z.string().max(40).optional()),
  source: z.enum(LEAD_SOURCES).default("manual"),
  primary_goal: optionalEnum(GOALS),
  how_heard: zfd.text().pipe(z.string().max(200).optional()),
  note: zfd.text().pipe(z.string().max(5000).optional()),
});

export async function createLeadManually(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(createSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  let leadId: string;
  try {
    const lead = await captureLead({
      trainerId: trainer.id,
      email: d.email,
      firstName: d.first_name,
      lastName: d.last_name,
      phone: d.phone,
      source: d.source,
      primaryGoal: d.primary_goal ?? undefined,
      howHeard: d.how_heard,
      attribution: {},
      skipRequestInfo: true,
    });
    leadId = lead.id;
    if (d.note) await recordLeadEvent(lead.id, "note", { text: d.note }, trainer.id);
  } catch (err) {
    console.error("[leads] manual create failed", err);
    return fail("Could not add the lead.");
  }
  refresh();
  redirect(`/coach/leads/${leadId}`);
}

// ---------------------------------------------------------------------------
// Qualification fields
// ---------------------------------------------------------------------------
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIMES = ["early_morning", "morning", "midday", "afternoon", "evening"] as const;

const detailsSchema = z.object({
  first_name: nullableText(100),
  last_name: nullableText(100),
  phone: nullableText(40),
  primary_goal: optionalEnum(GOALS),
  goal_details: nullableText(5000),
  experience_level: optionalEnum(EXPERIENCE_LEVELS),
  preferred_format: optionalEnum(FORMATS),
  budget_range: optionalEnum(BUDGETS),
  timeline: optionalEnum(TIMELINES),
  zip_code: nullableText(20),
  city: nullableText(100),
  injuries_or_limitations: nullableText(2000),
  how_heard: nullableText(200),
  notes: nullableText(10000),
  tags: zfd.text(),
  "preferred_days[]": z.array(z.enum(DAYS)).optional(),
  "preferred_times[]": z.array(z.enum(TIMES)).optional(),
});

export async function updateLeadDetails(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const parsed = parseForm(detailsSchema, formData);
  if (parsed.error) return parsed.error;
  const { tags, "preferred_days[]": days, "preferred_times[]": times, ...fields } = parsed.data;
  const { error } = await supabase
    .from("leads")
    .update({
      ...fields,
      preferred_days: days ?? [],
      preferred_times: times ?? [],
      tags: (tags ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
    })
    .eq("id", lead.id);
  if (error) return fail(error.message);
  await refreshLeadScore(lead.id);
  refresh(lead.id);
  return ok("Saved.");
}

// ---------------------------------------------------------------------------
// Pipeline: status, follow-ups, lost
// ---------------------------------------------------------------------------
const OPEN_STATUSES = ["new", "contacted", "consult_booked", "nurturing", "converted"] as const;

export async function changeLeadStatus(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trainer, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const parsed = z.enum(OPEN_STATUSES).safeParse(formData.get("status"));
  if (!parsed.success) return fail("Pick a status.");
  const status = parsed.data;
  if (status === lead.status) return ok("No change.");
  const { error } = await supabase
    .from("leads")
    .update({
      status,
      lost_reason: null,
      ...(status === "converted" && !lead.converted_at ? { converted_at: new Date().toISOString() } : {}),
    })
    .eq("id", lead.id);
  if (error) return fail(error.message);
  await recordLeadEvent(lead.id, "status_changed", { from: lead.status, to: status }, trainer.id);
  if (status === "converted") await recordLeadEvent(lead.id, "converted", { manual: true }, trainer.id);
  await refreshLeadScore(lead.id);
  refresh(lead.id);
  return ok("Status updated.");
}

/** Board quick action: move a lead to the next column. */
export async function moveLead(formData: FormData): Promise<void> {
  const leadId = String(formData.get("lead_id") ?? "");
  await changeLeadStatus(leadId, { ok: false }, formData);
}

export async function setFollowUp(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trainer, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const raw = String(formData.get("next_follow_up_at") ?? "").trim();
  let next: string | null = null;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return fail("Pick a date and time.");
    next = fromZonedTime(raw, trainer.timezone).toISOString();
  }
  const { error } = await supabase.from("leads").update({ next_follow_up_at: next }).eq("id", lead.id);
  if (error) return fail(error.message);
  await recordLeadEvent(lead.id, "note", { text: next ? `Follow-up set for ${raw.replace("T", " ")}` : "Follow-up cleared", kind: "follow_up", at: next }, trainer.id);
  refresh(lead.id);
  return ok(next ? "Follow-up scheduled." : "Follow-up cleared.");
}

const lostSchema = z.object({
  lost_reason: z.enum(values(LOST_REASONS)),
  lost_note: zfd.text().pipe(z.string().max(2000).optional()),
});

export async function markLost(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trainer, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const parsed = parseForm(lostSchema, formData);
  if (parsed.error) return parsed.error;
  const reason = parsed.data.lost_note ? `${parsed.data.lost_reason}: ${parsed.data.lost_note}` : parsed.data.lost_reason;
  const { error } = await supabase
    .from("leads")
    .update({ status: "lost", lost_reason: reason, next_follow_up_at: null })
    .eq("id", lead.id);
  if (error) return fail(error.message);
  await recordLeadEvent(lead.id, "status_changed", { from: lead.status, to: "lost", reason }, trainer.id);
  await refreshLeadScore(lead.id);
  refresh(lead.id);
  return ok("Marked as lost.");
}

// ---------------------------------------------------------------------------
// Notes, email, invite, delete
// ---------------------------------------------------------------------------
export async function addLeadNote(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trainer, lead } = await ownedLead(leadId);
  if (!lead) return fail("Lead not found.");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return fail("Write a note first.");
  if (text.length > 5000) return fail("Notes are limited to 5,000 characters.");
  await recordLeadEvent(lead.id, "note", { text }, trainer.id);
  refresh(lead.id);
  return ok("Note added.");
}

const emailSchema = z.object({
  subject: zfd.requiredText("Add a subject").pipe(z.string().max(200)),
  body: zfd.requiredText("Write a message").pipe(z.string().max(10000)),
});

export async function emailLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { trainer, lead } = await ownedLead(leadId);
  if (!lead) return fail("Lead not found.");
  const parsed = parseForm(emailSchema, formData);
  if (parsed.error) return parsed.error;
  const { subject, body } = parsed.data;
  const result = await sendEmail({
    to: lead.email,
    subject,
    paragraphs: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    replyTo: trainer.email,
    footerNote: leadEmailFooter(lead),
  });
  if (!result.ok) return fail("The email could not be sent. Please try again.");
  await recordLeadEvent(lead.id, "email_sent", { subject, body, email_id: result.id ?? null }, trainer.id);
  refresh(lead.id);
  return ok(`Email sent to ${lead.email}.`);
}

export async function inviteLeadAsClient(leadId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { trainer, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  if (lead.status === "converted" && lead.converted_client_id) return fail("This lead is already a client.");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id, role").eq("email", lead.email).maybeSingle();
  if (existing) {
    if (existing.role !== "client") return fail("That email belongs to a staff account.");
    // Already has an account: link them now and convert the lead.
    await admin
      .from("trainer_clients")
      .upsert({ trainer_id: trainer.id, client_id: existing.id, status: "active" }, { onConflict: "trainer_id,client_id" });
    await admin.rpc("ensure_conversation", { p_trainer: trainer.id, p_client: existing.id });
    await supabase
      .from("leads")
      .update({ status: "converted", converted_client_id: existing.id, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    await recordLeadEvent(lead.id, "converted", { client_id: existing.id, existing_account: true }, trainer.id);
    refresh(lead.id);
    return ok("They already had an account, so they're now linked as your client.");
  }

  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined;
  const { error } = await admin.auth.admin.inviteUserByEmail(lead.email, {
    redirectTo: absoluteUrl("/auth/callback?next=/me"),
    data: fullName ? { full_name: fullName } : undefined,
  });
  if (error) return fail(error.message || "Could not send the invitation.");
  await recordLeadEvent(lead.id, "invited", { email: lead.email }, trainer.id);
  refresh(lead.id);
  return ok("Invitation sent. They'll be marked as a client when they sign in.");
}

export async function deleteLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  if (formData.get("confirm") !== "on") return fail("Tick the box to confirm.");
  const { error } = await supabase.from("leads").delete().eq("id", lead.id);
  if (error) return fail(error.message);
  refresh();
  redirect("/coach/leads");
}
