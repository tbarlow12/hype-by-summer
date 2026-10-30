import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant";
import type { Profile } from "@/lib/auth";

/**
 * Make sure a signed-in client is attached to the trainer whose site they're
 * on (or `trainerId`), and that any matching lead is marked converted.
 * Idempotent. A person can be a client of several trainers' businesses.
 */
export async function ensureClientLinked(profile: Profile, trainerId?: string): Promise<string | null> {
  if (profile.role !== "client") return null;
  const admin = createAdminClient();

  const target = trainerId ?? (await getTenant())?.trainer_id;
  if (!target) return null;

  const { data: existing } = await admin
    .from("trainer_clients")
    .select("status")
    .eq("trainer_id", target)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (existing) return target;

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
