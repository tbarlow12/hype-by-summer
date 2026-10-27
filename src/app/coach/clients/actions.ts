"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, parseForm, zfd, type ActionState } from "@/lib/actions";
import { absoluteUrl } from "@/lib/env";
import { parseTags } from "@/lib/clients/metrics";

const addSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  full_name: zfd.text().pipe(z.string().max(120).optional()),
  goals: zfd.text().pipe(z.string().max(2000).optional()),
  tags: zfd.text(),
});

/**
 * Invite a client by email (or link an existing account) and open their chat
 * thread. The handle_new_user trigger makes invited users clients.
 */
export async function addClient(_: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(addSchema, formData);
  if (parsed.error) return parsed.error;
  const { email, full_name, goals, tags } = parsed.data;
  if (email === trainer.email.toLowerCase()) return fail("That's your own email.");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id, role, full_name").eq("email", email).maybeSingle();

  let clientId: string;
  let invited = false;
  if (existing) {
    if (existing.role !== "client") return fail("That email belongs to a staff account, not a client.");
    clientId = existing.id;
    if (full_name && !existing.full_name) await admin.from("profiles").update({ full_name }).eq("id", clientId);
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: absoluteUrl("/auth/callback?next=/me"),
      data: full_name ? { full_name } : undefined,
    });
    if (error || !data.user) return fail(error?.message ?? "Could not send the invitation.");
    clientId = data.user.id;
    invited = true;
  }

  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("trainer_clients")
    .select("status")
    .eq("trainer_id", trainer.id)
    .eq("client_id", clientId)
    .maybeSingle();
  const { error: relErr } = rel
    ? await supabase
        .from("trainer_clients")
        .update({
          status: rel.status === "archived" ? "active" : rel.status,
          ...(goals ? { goals } : {}),
          ...(tags ? { tags: parseTags(tags) } : {}),
        })
        .eq("trainer_id", trainer.id)
        .eq("client_id", clientId)
    : await supabase
        .from("trainer_clients")
        .insert({ trainer_id: trainer.id, client_id: clientId, status: "active", goals: goals ?? null, tags: parseTags(tags) });
  if (relErr) return fail(relErr.message);

  const { error: convoErr } = await supabase.rpc("ensure_conversation", { p_trainer: trainer.id, p_client: clientId });
  if (convoErr) console.error("[clients] ensure_conversation failed", convoErr);

  // A matching lead is now a client.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status")
    .eq("trainer_id", trainer.id)
    .eq("email", email)
    .maybeSingle();
  if (lead && lead.status !== "converted") {
    await supabase
      .from("leads")
      .update({ status: "converted", converted_client_id: clientId, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    await supabase.from("lead_events").insert({ lead_id: lead.id, type: "converted", detail: { client_id: clientId }, created_by: trainer.id });
  }

  revalidatePath("/coach/clients");
  redirect(`/coach/clients/${clientId}?added=${invited ? "invited" : "linked"}`);
}
