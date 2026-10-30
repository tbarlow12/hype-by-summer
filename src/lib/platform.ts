// Platform identity and host routing. Isomorphic (no server-only imports) so
// proxy.ts, server code and tests can share it.
//
// Hosts:
//   <PLATFORM_DOMAIN>, www., app.   -> the platform's own site (marketing, signup, admin)
//   <slug>.<PLATFORM_DOMAIN>        -> a trainer's white-labeled site
//   anything else                   -> a trainer's custom domain (looked up in the DB)

/** Placeholder until the product is named; change NEXT_PUBLIC_PLATFORM_NAME to rename. */
export const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || "TrainerOS";

/** Root host the platform runs on, e.g. "trainer-os.com" (port allowed for local dev). */
export const PLATFORM_DOMAIN = (process.env.NEXT_PUBLIC_PLATFORM_DOMAIN || "localhost:3000").toLowerCase();

/** On hosts that aren't the platform's (e.g. *.vercel.app previews), serve this tenant. */
export const DEFAULT_TENANT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || null;

const ROOT_SUBDOMAINS = new Set(["www", "app"]);

export type HostKind =
  | { kind: "platform" }
  | { kind: "subdomain"; slug: string }
  | { kind: "custom"; domain: string };

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

/** Classify a request host. Pure; the DB lookup for custom domains happens elsewhere. */
export function classifyHost(rawHost: string | null | undefined, platformDomain = PLATFORM_DOMAIN): HostKind {
  const host = normalizeHost(rawHost);
  const root = platformDomain.toLowerCase();
  if (!host || host === root) return { kind: "platform" };
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (ROOT_SUBDOMAINS.has(sub) || sub.includes(".")) return { kind: "platform" };
    return { kind: "subdomain", slug: sub };
  }
  // Same machine, different port/alias (e.g. 127.0.0.1 in dev) counts as the platform.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return { kind: "platform" };
  return { kind: "custom", domain: host.replace(/:\d+$/, "") };
}

function protocolFor(host: string): string {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || host.endsWith(".localhost") || /\.localhost:\d+$/.test(host)
    ? "http"
    : "https";
}

/** Absolute URL on the platform's own site. */
export function platformUrl(path = "/"): string {
  return `${protocolFor(PLATFORM_DOMAIN)}://${PLATFORM_DOMAIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export type TenantAddress = { slug: string; custom_domain?: string | null; domain_verified_at?: string | null };

/** Canonical host for a tenant: its verified custom domain, else its platform subdomain. */
export function tenantHost(t: TenantAddress, platformDomain = PLATFORM_DOMAIN): string {
  if (t.custom_domain && t.domain_verified_at) return t.custom_domain;
  return `${t.slug}.${platformDomain}`;
}

/** Absolute URL on a tenant's site (used in emails, Stripe redirects, SMS, ICS). */
export function tenantUrl(t: TenantAddress, path = "/", platformDomain = PLATFORM_DOMAIN): string {
  const host = tenantHost(t, platformDomain);
  return `${protocolFor(host)}://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Cookie domain shared by the platform and its subdomains (null when that can't work, e.g. localhost). */
export function sharedCookieDomain(host: string, platformDomain = PLATFORM_DOMAIN): string | null {
  const root = platformDomain.replace(/:\d+$/, "");
  if (!root.includes(".") || root.endsWith("localhost")) return null;
  const h = normalizeHost(host).replace(/:\d+$/, "");
  return h === root || h.endsWith(`.${root}`) ? `.${root}` : null;
}

/** Paths that exist only on the platform's own site (rewritten under /platform). */
export const PLATFORM_PATHS = ["/", "/pricing", "/start", "/admin", "/features", "/legal"];
export function isPlatformPath(pathname: string): boolean {
  return PLATFORM_PATHS.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}
