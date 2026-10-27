import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Row returned by the credit_grants_remaining() SQL function. */
export type CreditGrantRemaining = {
  grant_id: string;
  trainer_id: string;
  granted: number;
  remaining: number;
  reason: string;
  offering_id: string | null;
  session_type_ids: string[] | null;
  expires_at: string | null;
  created_at: string;
};

/** Unexpired credit grants with what's left on each (RLS-checked inside the function). */
export async function creditGrantsRemaining(
  supabase: SupabaseClient<Database>,
  clientId: string,
  trainerId?: string,
): Promise<CreditGrantRemaining[]> {
  const { data, error } = await supabase.rpc("credit_grants_remaining", {
    p_client: clientId,
    ...(trainerId ? { p_trainer: trainerId } : {}),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditGrantRemaining[];
}
