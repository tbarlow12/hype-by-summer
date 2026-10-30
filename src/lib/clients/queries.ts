import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ClientCreditBalance = { client_id: string; balance: number; granted: number };

/**
 * Usable credits + all-time granted credits for each client of a business
 * (client_credit_balances RPC; staff only).
 */
export async function clientCreditBalances(supabase: Supabase, businessId: string): Promise<ClientCreditBalance[]> {
  const { data, error } = await supabase.rpc("client_credit_balances", { p_business: businessId });
  if (error) {
    console.error("[clients] credit balances failed", error);
    return [];
  }
  return (data ?? []) as ClientCreditBalance[];
}
