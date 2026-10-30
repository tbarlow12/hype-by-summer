"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { isManager, requireStaff } from "@/lib/auth";
import { sendSignInInvite } from "@/lib/clients/invite";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { sendEmail } from "@/lib/email";
import { captureLead, leadEmailFooter, notifyLeadOwner, recordLeadEvent, refreshLeadScore } from "@/lib/leads";
import { ensureClientLinked } from "@/lib/onboarding";
import { brandOf } from "@/lib/tenant";
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

// The CRM is shared by the business's staff: any staff member can work any
// lead of the current business (RLS: is_member). Assignment only decides
// whose "My leads" view it lands in and who gets notified.

/** Loads a lead of the current business for a staff member (RLS + explicit business filter). */
async function ownedLead(leadId: string) {
  const ctx = await requireStaff();
  const actor = ctx.profile.id;
  if (!z.uuid().safeParse(leadId).success) return { ...ctx, actor, lead: null, supabase: null };
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).eq("business_id", ctx.business.id).maybeSingle();
  return { ...ctx, actor, lead, supabase };
}

/** Event on a lead of `businessId` by `actor`. */
const logEvent = (businessId: string, leadId: string, type: Parameters<typeof recordLeadEvent>[0]["type"], detail: Record<string, unknown>, actor: string) =>
  recordLeadEvent({ businessId, leadId, type, detail, createdBy: actor });

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
  const { profile, business } = await requireStaff();
  const parsed = parseForm(createSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  let leadId: string;
  try {
    const lead = await captureLead({
      businessId: business.id,
      // Whoever adds a lead owns it (unless it already exists with a coach).
      assignedCoachId: profile.id,
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
    if (d.note) await logEvent(business.id, lead.id, "note", { text: d.note }, profile.id);
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
  const { business, actor, lead, supabase } = await ownedLead(leadId);
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
  await logEvent(business.id, lead.id, "status_changed", { from: lead.status, to: status }, actor);
  if (status === "converted") await logEvent(business.id, lead.id, "converted", { manual: true }, actor);
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
  const { business, profile, actor, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const raw = String(formData.get("next_follow_up_at") ?? "").trim();
  let next: string | null = null;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return fail("Pick a date and time.");
    next = fromZonedTime(raw, profile.timezone).toISOString();
  }
  const { error } = await supabase.from("leads").update({ next_follow_up_at: next }).eq("id", lead.id);
  if (error) return fail(error.message);
  await logEvent(business.id, lead.id, "note", { text: next ? `Follow-up set for ${raw.replace("T", " ")}` : "Follow-up cleared", kind: "follow_up", at: next }, actor);
  refresh(lead.id);
  return ok(next ? "Follow-up scheduled." : "Follow-up cleared.");
}

const lostSchema = z.object({
  lost_reason: z.enum(values(LOST_REASONS)),
  lost_note: zfd.text().pipe(z.string().max(2000).optional()),
});

export async function markLost(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, actor, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const parsed = parseForm(lostSchema, formData);
  if (parsed.error) return parsed.error;
  const reason = parsed.data.lost_note ? `${parsed.data.lost_reason}: ${parsed.data.lost_note}` : parsed.data.lost_reason;
  const { error } = await supabase
    .from("leads")
    .update({ status: "lost", lost_reason: reason, next_follow_up_at: null })
    .eq("id", lead.id);
  if (error) return fail(error.message);
  await logEvent(business.id, lead.id, "status_changed", { from: lead.status, to: "lost", reason }, actor);
  await refreshLeadScore(lead.id);
  refresh(lead.id);
  return ok("Marked as lost.");
}

// ---------------------------------------------------------------------------
// Notes, email, invite, delete
// ---------------------------------------------------------------------------
export async function addLeadNote(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, actor, lead } = await ownedLead(leadId);
  if (!lead) return fail("Lead not found.");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return fail("Write a note first.");
  if (text.length > 5000) return fail("Notes are limited to 5,000 characters.");
  await logEvent(business.id, lead.id, "note", { text }, actor);
  refresh(lead.id);
  return ok("Note added.");
}

const emailSchema = z.object({
  subject: zfd.requiredText("Add a subject").pipe(z.string().max(200)),
  body: zfd.requiredText("Write a message").pipe(z.string().max(10000)),
});

export async function emailLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, profile, actor, lead } = await ownedLead(leadId);
  if (!lead) return fail("Lead not found.");
  const parsed = parseForm(emailSchema, formData);
  if (parsed.error) return parsed.error;
  const { subject, body } = parsed.data;
  const brand = brandOf(business);
  const result = await sendEmail({
    brand,
    to: lead.email,
    subject,
    paragraphs: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    // Replies go to the staff member who wrote it.
    replyTo: profile.email,
    footerNote: leadEmailFooter(brand, lead),
  });
  if (!result.ok) return fail("The email could not be sent. Please try again.");
  await logEvent(business.id, lead.id, "email_sent", { subject, body, email_id: result.id ?? null }, actor);
  refresh(lead.id);
  return ok(`Email sent to ${lead.email}.`);
}

export async function inviteLeadAsClient(leadId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _formData;
  const { business, actor, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  if (lead.status === "converted" && lead.converted_client_id) return fail("This lead is already a client.");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("*").eq("email", lead.email).maybeSingle();
  if (existing) {
    const { data: staff } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", business.id)
      .eq("user_id", existing.id)
      .maybeSingle();
    if (staff) return fail("That email belongs to a member of your team.");
    // Already has an account: make them a client of this business now (converts the lead).
    await ensureClientLinked(existing, business.id);
    if (lead.assigned_coach_id) {
      await admin
        .from("business_clients")
        .update({ primary_coach_id: lead.assigned_coach_id })
        .eq("business_id", business.id)
        .eq("client_id", existing.id)
        .is("primary_coach_id", null);
    }
    await supabase
      .from("leads")
      .update({ status: "converted", converted_client_id: existing.id, converted_at: lead.converted_at ?? new Date().toISOString() })
      .eq("id", lead.id);
    await logEvent(business.id, lead.id, "converted", { client_id: existing.id, existing_account: true }, actor);
    refresh(lead.id);
    return ok("They already had an account, so they're now linked as a client.");
  }

  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined;
  // Branded invite from this business (Supabase's own invite email would show the platform).
  const sent = await sendSignInInvite({ business, email: lead.email, fullName, next: "/me" });
  if (!sent.ok) return fail("Could not send the invitation.");
  await logEvent(business.id, lead.id, "invited", { email: lead.email }, actor);
  refresh(lead.id);
  return ok("Invitation sent. They'll be marked as a client when they sign in.");
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Reassign a lead. Managers can assign anyone on the team (or nobody);
 * coaches can claim an unassigned lead, or hand their own back.
 */
export async function assignLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, membership, actor, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  const raw = String(formData.get("assigned_coach_id") ?? "");
  const parsed = z.union([z.literal(""), z.uuid()]).safeParse(raw);
  if (!parsed.success) return fail("Pick a team member.");
  const to = parsed.data || null;
  if (to === lead.assigned_coach_id) return ok("No change.");

  if (!isManager(membership)) {
    const claiming = to === actor && lead.assigned_coach_id === null;
    const releasing = to === null && lead.assigned_coach_id === actor;
    if (!claiming && !releasing) return fail("Only owners and admins can reassign leads.");
  }
  let toName = "";
  if (to) {
    const { data: member } = await createAdminClient()
      .from("business_members")
      .select("user_id, profiles!business_members_user_id_fkey(full_name, email)")
      .eq("business_id", business.id)
      .eq("user_id", to)
      .eq("active", true)
      .maybeSingle();
    if (!member) return fail("That person isn't on your team.");
    toName = member.profiles?.full_name || member.profiles?.email || "a teammate";
  }
  const { error } = await supabase.from("leads").update({ assigned_coach_id: to }).eq("id", lead.id);
  if (error) return fail(error.message);
  await logEvent(business.id, lead.id, "note", { kind: "assigned", from: lead.assigned_coach_id, to, text: to ? `Assigned to ${toName}` : "Unassigned" }, actor);
  if (to && to !== actor) {
    await notifyLeadOwner(
      { id: lead.id, business_id: business.id, assigned_coach_id: to },
      { type: "lead_assigned", title: `Lead assigned to you: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email}` },
    );
  }
  refresh(lead.id);
  return ok(to ? "Lead assigned." : "Lead unassigned.");
}

export async function deleteLead(leadId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { membership, actor, lead, supabase } = await ownedLead(leadId);
  if (!lead || !supabase) return fail("Lead not found.");
  if (!isManager(membership) && lead.assigned_coach_id !== actor) return fail("Only owners, admins or the lead's coach can delete it.");
  if (formData.get("confirm") !== "on") return fail("Tick the box to confirm.");
  const { error } = await supabase.from("leads").delete().eq("id", lead.id);
  if (error) return fail(error.message);
  refresh();
  redirect("/coach/leads");
}
