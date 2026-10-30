"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { ensureAuthUser, sendSignInInvite } from "@/lib/clients/invite";
import { invitableRoles, roleLabel, slugify, teamChangeError, type Role } from "@/lib/clients/team-utils";

const role = z.enum(["owner", "admin", "coach", "staff"]);

const inviteSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  full_name: zfd.text().pipe(z.string().max(120).optional()),
  role,
  title: zfd.text().pipe(z.string().max(80).optional()),
  is_bookable: zfd.checkbox(),
});

/** Guard trigger errors -> friendly text. */
function teamError(error: { code?: string; message: string }): string {
  if (error.message.includes("only owners appoint owners")) return "Only an owner can appoint or change owners.";
  if (error.message.includes("a business needs an owner")) return "A business needs at least one active owner.";
  if (error.code === "42501") return "You don't have permission to do that.";
  return error.message;
}

/**
 * Add someone to the team (creating their account if needed) and email them
 * a branded sign-in link to the coach app.
 */
export async function inviteMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business, membership } = await requireManager();
  const parsed = parseForm(inviteSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (!invitableRoles(membership.role).includes(d.role)) return fail("Only an owner can add another owner.");

  const user = await ensureAuthUser(d.email, d.full_name);
  if ("error" in user) return fail(user.error);
  if (d.full_name) await createAdminClient().from("profiles").update({ full_name: d.full_name }).eq("id", user.userId).is("full_name", null);

  // Membership writes run as the manager (RLS + business_members_guard apply).
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("business_members")
    .select("role, active")
    .eq("business_id", business.id)
    .eq("user_id", user.userId)
    .maybeSingle();
  if (existing?.active) return fail(`${d.email} is already on your team as ${roleLabel(existing.role).toLowerCase()}.`);

  if (existing) {
    const err = teamChangeError({ actorId: profile.id, actorRole: membership.role, targetId: user.userId, targetRole: existing.role as Role, nextRole: d.role });
    if (err) return fail(err);
    const { error } = await supabase
      .from("business_members")
      .update({ active: true, role: d.role, is_bookable: d.is_bookable, ...(d.title ? { title: d.title } : {}) })
      .eq("business_id", business.id)
      .eq("user_id", user.userId);
    if (error) return fail(teamError(error));
  } else {
    const base = slugify(d.full_name ?? d.email.split("@")[0] ?? "") || null;
    let slug = base;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.from("business_members").insert({
        business_id: business.id,
        user_id: user.userId,
        role: d.role,
        title: d.title ?? null,
        is_bookable: d.is_bookable,
        slug,
        invited_by: profile.id,
      });
      if (!error) break;
      if (error.code === "23505" && base && attempt < 2) {
        slug = `${base.slice(0, 35)}-${Math.random().toString(36).slice(2, 6)}`;
        continue;
      }
      return fail(teamError(error));
    }
  }

  const sent = await sendSignInInvite({
    business,
    email: d.email,
    fullName: d.full_name,
    next: "/coach",
    subject: `Join ${business.name} as ${roleLabel(d.role).toLowerCase()}`,
    heading: `You're on the ${business.name} team`,
    paragraphs: [
      `${profile.full_name ?? "Your manager"} added you to ${business.name} as ${roleLabel(d.role).toLowerCase()}.`,
      "Sign in to see your schedule, clients and messages. No password needed; you can set one later under My profile.",
    ],
    ctaLabel: "Open the coach app",
  });
  revalidatePath("/coach/team");
  if (!sent.ok || !sent.emailed) return ok(`Added ${d.email}, but the invitation email couldn't be sent. Use “Resend invite”.`);
  return ok(`Invitation sent to ${d.email}.`);
}

const memberSchema = z.object({ user_id: z.uuid() });

async function loadTarget(businessId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_members")
    .select("user_id, role, active, profiles!business_members_user_id_fkey(email, full_name)")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return { supabase, target: data };
}

const updateSchema = memberSchema.extend({ role, is_bookable: zfd.checkbox(), title: zfd.text().pipe(z.string().max(80).optional()) });

export async function updateMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business, membership } = await requireManager();
  const parsed = parseForm(updateSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { supabase, target } = await loadTarget(business.id, d.user_id);
  if (!target) return fail("Team member not found");
  const err = teamChangeError({
    actorId: profile.id,
    actorRole: membership.role,
    targetId: target.user_id,
    targetRole: target.role,
    nextRole: d.role !== target.role ? d.role : undefined,
  });
  if (err) return fail(err);
  const { error } = await supabase
    .from("business_members")
    .update({ role: d.role, is_bookable: d.is_bookable, title: d.title ?? null })
    .eq("business_id", business.id)
    .eq("user_id", d.user_id);
  if (error) return fail(teamError(error));
  revalidatePath("/coach/team");
  return ok("Saved.");
}

const activeSchema = memberSchema.extend({ active: z.enum(["true", "false"]) });

export async function setMemberActive(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business, membership } = await requireManager();
  const parsed = parseForm(activeSchema, formData);
  if (parsed.error) return parsed.error;
  const active = parsed.data.active === "true";
  const { supabase, target } = await loadTarget(business.id, parsed.data.user_id);
  if (!target) return fail("Team member not found");
  const err = teamChangeError({
    actorId: profile.id,
    actorRole: membership.role,
    targetId: target.user_id,
    targetRole: target.role,
    deactivate: !active,
  });
  if (err) return fail(err);
  const { error } = await supabase
    .from("business_members")
    .update({ active })
    .eq("business_id", business.id)
    .eq("user_id", target.user_id);
  if (error) return fail(teamError(error));
  revalidatePath("/coach/team");
  return ok(active ? "Reactivated." : "Deactivated. They no longer have access; their history stays.");
}

export async function resendMemberInvite(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireManager();
  const parsed = parseForm(memberSchema, formData);
  if (parsed.error) return parsed.error;
  const { target } = await loadTarget(business.id, parsed.data.user_id);
  if (!target?.profiles?.email || !target.active) return fail("Team member not found");
  const sent = await sendSignInInvite({
    business,
    email: target.profiles.email,
    fullName: target.profiles.full_name,
    next: "/coach",
    subject: `Your sign-in link for ${business.name}`,
    heading: "Sign in to the coach app",
    paragraphs: [`Here's a fresh link to sign in to ${business.name}.`],
    ctaLabel: "Sign in",
  });
  if (!sent.ok) return fail(sent.error);
  if (!sent.emailed) return fail("The email couldn't be sent. Try again in a minute.");
  return ok(`Sign-in link sent to ${target.profiles.email}.`);
}
