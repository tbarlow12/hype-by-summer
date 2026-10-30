"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { sharedCookieDomain } from "@/lib/platform";
import type { Database } from "./database.types";

export function createClient() {
  const domain = typeof window === "undefined" ? undefined : (sharedCookieDomain(window.location.host) ?? undefined);
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: domain ? { domain } : undefined,
  });
}
