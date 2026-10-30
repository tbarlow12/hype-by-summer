// Custom domains: input normalisation and the DNS records a business must add.
// Pure (shared by the settings page, server actions and tests).

export const VERCEL_APEX_IP = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com";

/** Same rule as the businesses.custom_domain check constraint. */
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// Two-level public suffixes common enough to matter for "is this an apex?".
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk",
  "com.au", "net.au", "org.au", "id.au",
  "co.nz", "net.nz", "org.nz",
  "co.za", "com.br", "com.mx", "co.jp", "co.in", "co.kr", "com.sg", "com.hk", "co.il", "com.tr", "com.ar",
]);

/**
 * "https://www.Example.com/path" -> "www.example.com". Returns an error for
 * anything that isn't a plain hostname, or that is the platform's own domain.
 */
export function normalizeDomain(input: string, platformDomain: string): { domain: string } | { error: string } {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!d) return { error: "Enter a domain, e.g. book.yourstudio.com" };
  if (d.length > 253 || !DOMAIN_RE.test(d)) return { error: "That doesn't look like a domain. Use something like book.yourstudio.com" };
  const root = platformDomain.toLowerCase().replace(/:\d+$/, "");
  if (d === root || d.endsWith(`.${root}`)) return { error: "Use your own domain. Your platform address already works." };
  if (d.endsWith(".vercel.app")) return { error: "Use a domain you own." };
  return { domain: d };
}

/** The registrable domain ("book.studio.co.uk" -> "studio.co.uk"). */
export function apexOf(domain: string): string {
  const labels = domain.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const n = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-n).join(".");
}

export function isApexDomain(domain: string): boolean {
  return apexOf(domain) === domain;
}

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string; note?: string };

export type VerificationChallenge = { type: string; domain: string; value: string; reason?: string };

/**
 * Records to add at the DNS provider. `name` is relative to the apex, the way
 * most DNS dashboards ask for it ("@" for the apex itself).
 */
export function dnsRecordsFor(
  domain: string,
  opts: { verification?: VerificationChallenge[] | null; cname?: string | null; aValue?: string | null } = {},
): DnsRecord[] {
  const apex = apexOf(domain);
  const relative = (host: string) => (host === apex ? "@" : host.endsWith(`.${apex}`) ? host.slice(0, -(apex.length + 1)) : host);
  const records: DnsRecord[] = isApexDomain(domain)
    ? [{ type: "A", name: "@", value: opts.aValue || VERCEL_APEX_IP }]
    : [{ type: "CNAME", name: relative(domain), value: opts.cname || VERCEL_CNAME }];
  for (const v of opts.verification ?? []) {
    if (!v?.type || !v.value) continue;
    const type = v.type.toUpperCase();
    if (type !== "TXT" && type !== "CNAME" && type !== "A") continue;
    records.push({
      type: type as DnsRecord["type"],
      name: relative(v.domain || `_vercel.${apex}`),
      value: v.value,
      note: "Proves you own the domain",
    });
  }
  return records;
}

/** Does a DNS lookup result point at the platform? (manual verification without the Vercel API) */
export function dnsPointsAtPlatform(
  domain: string,
  found: { cnames?: string[]; a?: string[] },
  expected: { cname?: string; ip?: string } = {},
): boolean {
  const ip = expected.ip ?? VERCEL_APEX_IP;
  const cname = (expected.cname ?? VERCEL_CNAME).toLowerCase().replace(/\.$/, "");
  if ((found.a ?? []).includes(ip)) return true;
  if (isApexDomain(domain)) return false;
  return (found.cnames ?? []).some((c) => {
    const v = c.toLowerCase().replace(/\.$/, "");
    return v === cname || v.endsWith(".vercel-dns.com");
  });
}
