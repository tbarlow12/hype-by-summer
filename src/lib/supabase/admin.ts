import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "./database.types";

let admin: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role client: bypasses RLS. Use only in trusted server code (webhooks,
 * booking/payment flows, cron) and always scope queries explicitly.
 */
export function createAdminClient() {
  admin ??= createClient<Database>(SUPABASE_URL, serverEnv.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
