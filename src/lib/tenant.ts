import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyHost, DEFAULT_TENANT_SLUG, PLATFORM_NAME, platformUrl, tenantUrl as buildTenantUrl } from "@/lib/platform";
import { brandPalette, type BrandPalette } from "@/lib/brand-palette";

// A tenant is one trainer's white-labeled business (a trainer_profiles row).
// Every request is served for exactly one tenant, chosen by its host, or for
// the platform itself (tenant = null).

const TENANT_SELECT =
  "*, profiles!trainer_profiles_trainer_id_fkey(full_name, avatar_url, timezone, email)" as const;

async function fetchTenant(column: "slug" | "custom_domain" | "trainer_id", value: string) {
  const { data } = await createAdminClient()
    .from("trainer_profiles")
    .select(TENANT_SELECT)
    .eq(column, value)
    .maybeSingle();
  if (!data) return null;
  // The calendar feed token is a credential; never let it travel with the tenant.
  const { calendar_feed_token: _secret, ...tenant } = data;
  void _secret;
  return tenant;
}

export type Tenant = NonNullable<Awaited<ReturnType<typeof fetchTenant>>>;

/** Host of the current request (respects proxies). */
export async function requestHost(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}

/** The tenant this request is for, or null on the platform's own site. Cached per request. */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const host = classifyHost(await requestHost());
  let tenant: Tenant | null = null;
  if (host.kind === "subdomain") tenant = await fetchTenant("slug", host.slug);
  else if (host.kind === "custom") {
    tenant = await fetchTenant("custom_domain", host.domain);
    if (tenant && !tenant.domain_verified_at) tenant = null;
    // Preview / single-business deployments on hosts we don't own.
    if (!tenant && DEFAULT_TENANT_SLUG) tenant = await fetchTenant("slug", DEFAULT_TENANT_SLUG);
  } else if (DEFAULT_TENANT_SLUG && process.env.NEXT_PUBLIC_PLATFORM_DOMAIN === undefined) {
    // No platform domain configured at all: behave as a single-business site.
    tenant = await fetchTenant("slug", DEFAULT_TENANT_SLUG);
  }
  if (tenant?.status === "suspended") return null;
  return tenant;
});

/** True when this request is for the platform's own site (no tenant). */
export async function isPlatformRequest(): Promise<boolean> {
  return (await getTenant()) === null;
}

/** The current tenant, or a 404 (e.g. an unknown subdomain). */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) notFound();
  return tenant;
}

/** Tenant for server work without a request host (webhooks, cron, emails). */
export const getTenantByTrainerId = cache(async (trainerId: string) => fetchTenant("trainer_id", trainerId));

/**
 * Look up a storefront by slug, but only the current request's tenant: a
 * trainer's domain must never serve another trainer's booking pages.
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const tenant = await getTenant();
  return tenant && tenant.slug === slug.toLowerCase() ? tenant : null;
}

/** Absolute URL on a tenant's own site. */
export function tenantUrl(tenant: Pick<Tenant, "slug" | "custom_domain" | "domain_verified_at">, path = "/"): string {
  return buildTenantUrl(tenant, path);
}

/** Absolute URL on the current request's site (tenant or platform). */
export async function siteUrl(path = "/"): Promise<string> {
  const host = await requestHost();
  const proto = /^(localhost|127\.0\.0\.1)|\.localhost(:\d+)?$/.test(host) ? "http" : "https";
  return `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

export type Brand = {
  name: string;
  logoUrl: string | null;
  palette: BrandPalette;
  siteUrl: string;
  /** Where client replies should go (trainer's support or login email). */
  replyTo: string | null;
  trainerId: string | null;
};

/** Everything emails, SMS, ICS and the UI need to present a tenant's brand. */
export function brandOf(tenant: Tenant | null): Brand {
  if (!tenant) {
    return { name: PLATFORM_NAME, logoUrl: null, palette: brandPalette(null), siteUrl: platformUrl("/"), replyTo: null, trainerId: null };
  }
  return {
    name: tenant.business_name,
    logoUrl: tenant.logo_url,
    palette: brandPalette(tenant.brand_color),
    siteUrl: tenantUrl(tenant),
    replyTo: tenant.support_email ?? tenant.profiles?.email ?? null,
    trainerId: tenant.trainer_id,
  };
}

/** Brand for a trainer when there is no request host (webhooks, cron). */
export async function brandForTrainer(trainerId: string): Promise<Brand> {
  return brandOf(await getTenantByTrainerId(trainerId));
}

