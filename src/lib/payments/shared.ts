import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";

export type Admin = ReturnType<typeof createAdminClient>;

export const isUniqueViolation = (err: { code?: string } | null | undefined) => err?.code === "23505";

export const automaticTaxEnabled = () => serverEnv.stripeAutomaticTax();

/** Attach a paying client to the trainer (and open their chat thread). Idempotent. */
export async function linkClientToTrainer(admin: Admin, trainerId: string, clientId: string | null | undefined) {
  if (!clientId || clientId === trainerId) return;
  const { data: client } = await admin.from("profiles").select("role").eq("id", clientId).maybeSingle();
  if (!client || client.role !== "client") return;
  await admin
    .from("trainer_clients")
    .upsert({ trainer_id: trainerId, client_id: clientId, status: "active" }, { onConflict: "trainer_id,client_id", ignoreDuplicates: true });
  // Re-activate an archived/paused relationship when they buy again.
  await admin
    .from("trainer_clients")
    .update({ status: "active" })
    .eq("trainer_id", trainerId)
    .eq("client_id", clientId)
    .in("status", ["archived", "paused", "invited"]);
  await admin.rpc("ensure_conversation", { p_trainer: trainerId, p_client: clientId });
}

export const DIGITAL_BUCKET = "digital-products";

/** Signed download URL for a purchased digital product. */
export async function signedDownloadUrl(
  admin: Admin,
  path: string,
  fileName: string | null,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(DIGITAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds, { download: fileName ?? path.split("/").pop() ?? true });
  if (error) {
    console.error("[payments] signed url failed", error);
    return null;
  }
  return data.signedUrl;
}
