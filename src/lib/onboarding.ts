import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";

/**
 * Make a signed-in person a client of a business (idempotent): creates the
 * relationship and chat thread, links guest bookings made with their email,
 * and marks a matching lead converted.
 */
export async function ensureClientLinked(profile: Tables<"profiles">, businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("business_clients")
    .select("status")
    .eq("business_id", businessId)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (existing) return;

  await admin
    .from("business_clients")
    .upsert({ business_id: businessId, client_id: profile.id, status: "active" }, { onConflict: "business_id,client_id", ignoreDuplicates: true });
  await admin.rpc("ensure_conversation", { p_business: businessId, p_client: profile.id });

  // Bookings they made as a guest at this business become theirs.
  await admin
    .from("bookings")
    .update({ client_id: profile.id })
    .eq("business_id", businessId)
    .is("client_id", null)
    .eq("guest_email", profile.email);

  const { data: lead } = await admin
    .from("leads")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("email", profile.email)
    .maybeSingle();
  if (lead && lead.status !== "converted") {
    await admin
      .from("leads")
      .update({ status: "converted", converted_client_id: profile.id, converted_at: new Date().toISOString() })
      .eq("id", lead.id);
    await admin.from("lead_events").insert({ lead_id: lead.id, type: "converted", detail: { client_id: profile.id } });
  }
}
