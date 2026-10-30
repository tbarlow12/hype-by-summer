// Public configuration shared by server and browser code. Business names,
// colors and URLs are per tenant: see lib/tenant.ts (brandOf, businessUrl,
// siteUrl) and lib/platform.ts (platform name/domain).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
