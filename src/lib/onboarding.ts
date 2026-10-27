import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPrimaryTrainer } from "@/lib/trainer";
import type { Profile } from "@/lib/auth";

/**
 * Make sure a signed-in client is attached to a trainer (the primary one by
 * default) and that any matching lead is marked converted. Idempotent.
 */
export async function ensureClientLinked(profile: Profile, trainerId?: string): Promise<string | null> {
  if (profile.role !== "client") return null;
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("trainer_clients")
    .select("trainer_id")
    .eq("client_id", profile.id)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle();
  if (existing && !trainerId) return existing.trainer_id;

  const target = trainerId ?? (await getPrimaryTrainer())?.trainer_id;
  if (!target) return null;

  await admin
    .from("trainer_clients")
    .upsert({ trainer_id: target, client_id: profile.id, status: "active" }, { onConflict: "trainer_id,client_id", ignoreDuplicates: true });
  await admin.rpc("ensure_conversation", { p_trainer: target, p_client: profile.id });

  const { data: lead } = await admin
    .from("leads")
    .select("id, status")
    .eq("trainer_id", target)
    .eq("email", profile.email)
    .maybeSingle();
  if (lead && lead.status !== "converted") {
    await admin
      .from("leads")
      .update({ status: "converted", converted_client_id: profile.id, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    await admin.from("lead_events").insert({ lead_id: lead.id, type: "converted", detail: { client_id: profile.id } });
  }
  return target;
}
