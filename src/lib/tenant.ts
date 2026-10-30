import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyHost, DEFAULT_TENANT_SLUG, PLATFORM_NAME, platformUrl, tenantUrl } from "@/lib/platform";
import { brandPalette, type BrandPalette } from "@/lib/brand-palette";
import type { Tables } from "@/lib/supabase/database.types";

// Every request is served for exactly one business (the tenant), chosen by
// its host, or for the platform's own site (business = null). This is
// white-label software: a business's site only ever shows that business.

export type Business = Tables<"businesses">;

async function fetchBusiness(column: "slug" | "custom_domain" | "id", value: string): Promise<Business | null> {
  const { data } = await createAdminClient().from("businesses").select("*").eq(column, value).maybeSingle();
  return data;
}

/** Host of the current request (respects proxies). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}

/** The business this request is for, or null on the platform's own site. Cached per request. */
export const getBusiness = cache(async (): Promise<Business | null> => {
  const host = classifyHost(await requestHost());
  let business: Business | null = null;
  if (host.kind === "subdomain") business = await fetchBusiness("slug", host.slug);
  else if (host.kind === "custom") {
    business = await fetchBusiness("custom_domain", host.domain);
    if (business && !business.domain_verified_at) business = null;
    // Preview deployments on hosts we don't own (e.g. *.vercel.app).
    if (!business && DEFAULT_TENANT_SLUG) business = await fetchBusiness("slug", DEFAULT_TENANT_SLUG);
  } else if (DEFAULT_TENANT_SLUG && process.env.NEXT_PUBLIC_PLATFORM_DOMAIN === undefined) {
    // No platform domain configured: behave as a single-business site.
    business = await fetchBusiness("slug", DEFAULT_TENANT_SLUG);
  }
  if (business?.status === "suspended") return null;
  return business;
});

/** The current business, or a 404 (unknown subdomain, unverified domain, suspended). */
export async function requireBusiness(): Promise<Business> {
  const business = await getBusiness();
  if (!business) notFound();
  return business;
}

/** A business by id for server work without a request host (webhooks, cron, emails). */
export const getBusinessById = cache(async (id: string) => fetchBusiness("id", id));

/** Absolute URL on a business's own site (emails, Stripe redirects, SMS, ICS). */
export function businessUrl(business: Pick<Business, "slug" | "custom_domain" | "domain_verified_at">, path = "/"): string {
  return tenantUrl(business, path);
}

/** Absolute URL on the current request's site (business or platform). */
export async function siteUrl(path = "/"): Promise<string> {
  const host = await requestHost();
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$|\.localhost(:\d+)?$/.test(host) ? "http" : "https";
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The platform's own accent (matches src/app/platform/platform.css). */
const PLATFORM_BRAND_COLOR = "#4537e6";

export type Brand = {
  /** Name shown to clients (never the platform's on a business site). */
  name: string;
  logoUrl: string | null;
  palette: BrandPalette;
  /** Absolute base URL of the business's site. */
  siteUrl: string;
  /** Where client replies go (business support email). */
  replyTo: string | null;
  businessId: string | null;
  timezone: string;
};

/** Everything emails, SMS, ICS and the UI need to present a business's brand. */
export function brandOf(business: Business | null): Brand {
  if (!business) {
    return {
      name: PLATFORM_NAME, logoUrl: null, palette: brandPalette(PLATFORM_BRAND_COLOR), siteUrl: platformUrl("/"),
      replyTo: null, businessId: null, timezone: "America/Denver",
    };
  }
  return {
    name: business.name,
    logoUrl: business.logo_url,
    palette: brandPalette(business.brand_color),
    siteUrl: businessUrl(business),
    replyTo: business.support_email,
    businessId: business.id,
    timezone: business.timezone,
  };
}

/** Brand for a business when there is no request host (webhooks, cron). */
export async function brandForBusiness(businessId: string): Promise<Brand> {
  return brandOf(await getBusinessById(businessId));
}
