"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, parseForm, zfd, type ActionState } from "@/lib/actions";
import { parseTags } from "@/lib/clients/metrics";
import { ensureAuthUser, sendSignInInvite } from "@/lib/clients/invite";

const addSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  full_name: zfd.text().pipe(z.string().max(120).optional()),
  goals: zfd.text().pipe(z.string().max(2000).optional()),
  tags: zfd.text(),
  primary_coach_id: zfd.text().pipe(z.uuid().optional()),
  send_invite: zfd.checkbox(),
});

/**
 * Add a client to this business by email: creates their account if needed,
 * links them (relationship + chat thread, matching lead converted) and emails
 * a branded sign-in link to the business's site.
 */
export async function addClient(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireStaff();
  const parsed = parseForm(addSchema, formData);
  if (parsed.error) return parsed.error;
  const { email, full_name, goals, tags, primary_coach_id, send_invite } = parsed.data;
  if (email === profile.email.toLowerCase()) return fail("That's your own email.");

  const admin = createAdminClient();
  const user = await ensureAuthUser(email, full_name);
  if ("error" in user) return fail(user.error);
  const clientId = user.userId;

  const { data: member } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", business.id)
    .eq("user_id", clientId)
    .maybeSingle();
  if (member) return fail("That email belongs to someone on your team.");
  if (full_name) {
    await admin.from("profiles").update({ full_name }).eq("id", clientId).is("full_name", null);
  }

  // Staff write the relationship under RLS; a DB trigger checks the coach is on the team.
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("business_clients")
    .select("status")
    .eq("business_id", business.id)
    .eq("client_id", clientId)
    .maybeSingle();
  const coach = primary_coach_id ?? null;
  const { error: relErr } = rel
    ? await supabase
        .from("business_clients")
        .update({
          status: rel.status === "archived" ? "active" : rel.status,
          ...(goals ? { goals } : {}),
          ...(tags ? { tags: parseTags(tags) } : {}),
          ...(coach ? { primary_coach_id: coach } : {}),
        })
        .eq("business_id", business.id)
        .eq("client_id", clientId)
    : await supabase.from("business_clients").insert({
        business_id: business.id,
        client_id: clientId,
        status: user.created ? "invited" : "active",
        goals: goals ?? null,
        tags: parseTags(tags),
        primary_coach_id: coach,
      });
  if (relErr) return fail(relErr.message.includes("primary_coach_not_member") ? "Pick a coach from your team." : relErr.message);

  const { error: convoErr } = await supabase.rpc("ensure_conversation", { p_business: business.id, p_client: clientId });
  if (convoErr) console.error("[clients] ensure_conversation failed", convoErr);

  // A matching lead is now a client.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status")
    .eq("business_id", business.id)
    .eq("email", email)
    .maybeSingle();
  if (lead && lead.status !== "converted") {
    await supabase
      .from("leads")
      .update({ status: "converted", converted_client_id: clientId, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    await supabase.from("lead_events").insert({ lead_id: lead.id, type: "converted", detail: { client_id: clientId }, created_by: profile.id });
  }

  let outcome = user.created ? "created" : "linked";
  if (send_invite) {
    const sent = await sendSignInInvite({ business, email, fullName: full_name, next: "/me" });
    outcome = sent.ok && sent.emailed ? "invited" : `${outcome}-noemail`;
  }

  revalidatePath("/coach/clients");
  redirect(`/coach/clients/${clientId}?added=${outcome}`);
}

const resendSchema = z.object({ client_id: z.uuid() });

/** Email the client a fresh branded sign-in link. */
export async function resendInvite(_: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireStaff();
  const parsed = parseForm(resendSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("business_clients")
    .select("client_id, profiles!business_clients_client_id_fkey(email, full_name)")
    .eq("business_id", business.id)
    .eq("client_id", parsed.data.client_id)
    .maybeSingle();
  if (!rel?.profiles?.email) return fail("Client not found");
  const sent = await sendSignInInvite({ business, email: rel.profiles.email, fullName: rel.profiles.full_name, next: "/me" });
  if (!sent.ok) return fail(sent.error);
  if (!sent.emailed) return fail("The email couldn't be sent. Try again in a minute.");
  return { ok: true, message: `Sign-in link sent to ${rel.profiles.email}.` };
}
