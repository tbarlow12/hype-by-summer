import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ClientCreditBalance = { client_id: string; balance: number; granted: number };

/**
 * Usable credits + all-time granted credits for each of a trainer's clients
 * (trainer_client_credit_balances RPC; the type generator can't describe
 * `returns table`, hence the cast).
 */
export async function trainerCreditBalances(supabase: Supabase, trainerId: string): Promise<ClientCreditBalance[]> {
  const { data, error } = await supabase.rpc("trainer_client_credit_balances", { p_trainer: trainerId });
  if (error) {
    console.error("[clients] credit balances failed", error);
    return [];
  }
  return (data ?? []) as ClientCreditBalance[];
}
