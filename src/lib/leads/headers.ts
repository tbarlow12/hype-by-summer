// Request metadata from proxy headers (Vercel / generic). Pure.

export type ClientInfo = { ipAddress?: string; userAgent?: string; country?: string };

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function clientInfoFromHeaders(h: { get(name: string): string | null }): ClientInfo {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  // Strip an IPv4 port ("1.2.3.4:5678") and validate so the inet cast can't fail.
  const ipCandidate = forwarded?.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
  const ipAddress =
    ipCandidate && (IPV4.test(ipCandidate) ? ipCandidate.split(".").every((p) => Number(p) <= 255) : IPV6.test(ipCandidate) && ipCandidate.includes(":"))
      ? ipCandidate
      : undefined;
  const userAgent = h.get("user-agent")?.slice(0, 500) || undefined;
  const country = h.get("x-vercel-ip-country")?.trim().toUpperCase();
  return { ipAddress, userAgent, country: country && /^[A-Z]{2}$/.test(country) ? country : undefined };
}
