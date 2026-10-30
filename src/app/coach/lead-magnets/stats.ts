import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MagnetStats = { leads: number; downloads: number; unique_downloads: number; converted: number; consults: number };

const EMPTY: MagnetStats = { leads: 0, downloads: 0, unique_downloads: 0, converted: 0, consults: 0 };

/** Funnel stats per lead magnet id for a business (RLS-scoped RPC: staff of that business only). */
export async function magnetStats(businessId: string): Promise<Map<string, MagnetStats>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lead_magnet_stats", { p_business: businessId });
  const rows = (Array.isArray(data) ? data : []) as (MagnetStats & { lead_magnet_id: string })[];
  return new Map(rows.map(({ lead_magnet_id, ...s }) => [lead_magnet_id, { ...EMPTY, ...s }]));
}

export const statsFor = (map: Map<string, MagnetStats>, id: string) => map.get(id) ?? EMPTY;

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
