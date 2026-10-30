import "server-only";
import { resolve4, resolveCname } from "node:dns/promises";
import { dnsPointsAtPlatform, type VerificationChallenge } from "./domains";

// Custom domains on the Vercel project (REST API). Env: VERCEL_TOKEN,
// VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID. Without them the settings page
// falls back to DNS instructions + a manual DNS check.

const API = "https://api.vercel.com";

export function vercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

export type DomainStatus = {
  /** Vercel has verified ownership (no TXT challenge pending). */
  verified: boolean;
  /** DNS doesn't point at Vercel yet. */
  misconfigured: boolean;
  verification: VerificationChallenge[];
  /** Vercel's recommended targets, when it reports them. */
  cname: string | null;
  aValue: string | null;
  error?: string;
};

type VercelError = { error?: { code?: string; message?: string } };
type ProjectDomain = { name: string; verified: boolean; verification?: VerificationChallenge[] } & VercelError;
type DomainConfig = {
  misconfigured?: boolean;
  recommendedCNAME?: { rank: number; value: string }[];
  recommendedIPv4?: { rank: number; value: string[] }[];
} & VercelError;

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const url = new URL(path, API);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");

/** Add the domain to the project. Already-added (to this project) counts as success. */
export async function addProjectDomain(domain: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { status, data } = await call<ProjectDomain>("POST", `/v10/projects/${project()}/domains`, { name: domain });
  if (status < 300) return { ok: true };
  const code = data.error?.code;
  if (code === "domain_already_in_use" || code === "domain_already_exists") {
    // Fine if it is on this project already.
    const existing = await call<ProjectDomain>("GET", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
    if (existing.status < 300) return { ok: true };
    return { ok: false, error: "That domain is already connected to another site. Remove it there first." };
  }
  return { ok: false, error: data.error?.message ?? `Vercel returned ${status}` };
}

export async function removeProjectDomain(domain: string): Promise<{ ok: boolean; error?: string }> {
  const { status, data } = await call<VercelError>("DELETE", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`);
  if (status < 300 || status === 404) return { ok: true };
  return { ok: false, error: data.error?.message ?? `Vercel returned ${status}` };
}

/** Ownership verification + DNS configuration, as Vercel sees it right now. */
export async function projectDomainStatus(domain: string, { verify = false } = {}): Promise<DomainStatus> {
  const d = encodeURIComponent(domain);
  if (verify) await call("POST", `/v9/projects/${project()}/domains/${d}/verify`);
  const [pd, cfg] = await Promise.all([
    call<ProjectDomain>("GET", `/v9/projects/${project()}/domains/${d}`),
    call<DomainConfig>("GET", `/v6/domains/${d}/config`),
  ]);
  const best = <T extends { rank: number }>(list?: T[]) => [...(list ?? [])].sort((a, b) => a.rank - b.rank)[0];
  if (pd.status >= 300) {
    return {
      verified: false, misconfigured: true, verification: [], cname: null, aValue: null,
      error: pd.status === 404 ? "not_added" : (pd.data.error?.message ?? `Vercel returned ${pd.status}`),
    };
  }
  return {
    verified: Boolean(pd.data.verified),
    misconfigured: cfg.status >= 300 ? true : Boolean(cfg.data.misconfigured),
    verification: pd.data.verification ?? [],
    cname: best(cfg.data.recommendedCNAME)?.value?.replace(/\.$/, "") ?? null,
    aValue: best(cfg.data.recommendedIPv4)?.value?.[0] ?? null,
  };
}

/** Without the Vercel API: does public DNS already point the domain at us? */
export async function domainResolvesToPlatform(domain: string): Promise<boolean> {
  const [cnames, a] = await Promise.all([
    resolveCname(domain).catch(() => [] as string[]),
    resolve4(domain).catch(() => [] as string[]),
  ]);
  return dnsPointsAtPlatform(domain, { cnames, a });
}
