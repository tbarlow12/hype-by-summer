// Centralised environment access. Server-only secrets live in lib/env.server.ts.
// On Vercel, fall back to the project's production domain so NEXT_PUBLIC_SITE_URL
// is only needed for a custom domain.
const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000")
).replace(/\/$/, "");
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? "HYPE by Summer";
export const PRIMARY_TRAINER_SLUG = process.env.NEXT_PUBLIC_PRIMARY_TRAINER_SLUG ?? "summer";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
