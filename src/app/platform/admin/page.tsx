import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatMoney } from "@/lib/format";
import { tenantHost, tenantUrl } from "@/lib/platform";
import { Badge } from "@/components/ui";
import { Section } from "../_components/ui";
import { formatBps } from "../plans";
import { StatusButton } from "./status-button";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const PAGE = 100;

type Filter = "all" | "active" | "suspended" | "starter" | "pro";
const FILTERS: Filter[] = ["all", "active", "suspended", "starter", "pro"];

export default async function AdminPage({ searchParams }: PageProps<"/platform/admin">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : "all";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const db = createAdminClient();

  let query = db
    .from("businesses")
    .select(
      "id, name, slug, custom_domain, domain_verified_at, plan, platform_fee_bps, platform_subscription_status, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, status, created_at, support_email",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (q) {
    // Strip PostgREST filter syntax from the search term.
    const term = q.replace(/[,()*%\\:"']/g, " ").trim();
    if (term) query = query.or(`name.ilike.*${term}*,slug.ilike.*${term}*,custom_domain.ilike.*${term}*,support_email.ilike.*${term}*`);
  }
  if (filter === "active" || filter === "suspended") query = query.eq("status", filter);
  if (filter === "starter" || filter === "pro") query = query.eq("plan", filter);

  const [{ data: businesses, count, error }, { data: stats }] = await Promise.all([query, db.rpc("platform_business_stats")]);
  if (error) console.error("[platform-admin] list", error);
  const byId = new Map((stats ?? []).map((s) => [s.business_id, s]));
  const totals = (stats ?? []).reduce(
    (t, s) => ({
      processed: t.processed + (s.processed_cents ?? 0) - (s.refunded_cents ?? 0),
      fees: t.fees + (s.fees_cents ?? 0) - (s.fees_refunded_cents ?? 0),
      clients: t.clients + (s.clients ?? 0),
    }),
    { processed: 0, fees: 0, clients: 0 },
  );
  const rows = businesses ?? [];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, filter, page, ...over };
    if (merged.q) p.set("q", String(merged.q));
    if (merged.filter && merged.filter !== "all") p.set("filter", String(merged.filter));
    if (merged.page && Number(merged.page) > 1) p.set("page", String(merged.page));
    const s = p.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  return (
    <Section className="max-w-7xl py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Platform admin</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Businesses</h1>
          <p className="mt-1 text-sm p-muted">Signed in as {admin.email}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Businesses", (stats ?? []).length.toLocaleString()],
          ["Clients", totals.clients.toLocaleString()],
          ["Processed (net of refunds)", formatMoney(totals.processed)],
          ["Platform fees earned", formatMoney(totals.fees)],
        ].map(([label, value]) => (
          <div key={label} className="p-surface rounded-2xl border p-line p-4">
            <p className="text-xs font-medium p-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <form className="mt-8 flex flex-wrap items-center gap-2" role="search">
        <label htmlFor="admin-q" className="sr-only">
          Search businesses
        </label>
        <input
          id="admin-q"
          name="q"
          defaultValue={q}
          placeholder="Search name, address, domain or email"
          className="p-surface h-10 min-w-0 flex-1 rounded-full border p-line px-4 text-sm outline-none focus:border-brand sm:max-w-sm"
        />
        {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
        <button type="submit" className="h-10 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand">
          Search
        </button>
        <nav aria-label="Filter" className="flex flex-wrap gap-1 sm:ml-auto">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={href({ filter: f, page: 1 })}
              aria-current={filter === f ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm capitalize ${filter === f ? "p-ink" : "p-muted hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]"}`}
            >
              {f}
            </Link>
          ))}
        </nav>
      </form>

      <div className="p-surface mt-4 overflow-x-auto rounded-2xl border p-line">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b p-line text-xs uppercase tracking-wide p-muted">
            <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-semibold">
              <th>Business</th>
              <th>Plan</th>
              <th>Stripe</th>
              <th className="text-right">Team</th>
              <th className="text-right">Clients</th>
              <th className="text-right">Processed</th>
              <th className="text-right">Fees</th>
              <th>Created</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const s = byId.get(b.id);
              const processed = (s?.processed_cents ?? 0) - (s?.refunded_cents ?? 0);
              const fees = (s?.fees_cents ?? 0) - (s?.fees_refunded_cents ?? 0);
              return (
                <tr key={b.id} className="border-t p-line align-top [&>td]:px-4 [&>td]:py-3">
                  <td>
                    <p className="font-semibold">{b.name}</p>
                    <a href={tenantUrl(b)} target="_blank" rel="noreferrer" className="text-xs p-muted hover:text-brand">
                      {tenantHost(b)}
                    </a>
                    {b.custom_domain && !b.domain_verified_at ? (
                      <p className="text-xs text-amber-700 dark:text-amber-300">{b.custom_domain} (unverified)</p>
                    ) : null}
                    {b.support_email ? <p className="text-xs p-muted">{b.support_email}</p> : null}
                  </td>
                  <td>
                    {b.plan === "pro" ? <Badge tone="purple">Pro</Badge> : <Badge>Starter · {formatBps(b.platform_fee_bps)}</Badge>}
                    {b.plan === "pro" && b.platform_subscription_status ? (
                      <p className="mt-1 text-xs p-muted">{b.platform_subscription_status}</p>
                    ) : null}
                  </td>
                  <td>
                    {!b.stripe_account_id ? (
                      <Badge>Not connected</Badge>
                    ) : b.stripe_charges_enabled && b.stripe_payouts_enabled ? (
                      <Badge tone="green">Active</Badge>
                    ) : b.stripe_details_submitted ? (
                      <Badge tone="amber">Restricted</Badge>
                    ) : (
                      <Badge tone="amber">Onboarding</Badge>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{s?.members ?? 0}</td>
                  <td className="text-right tabular-nums">{s?.clients ?? 0}</td>
                  <td className="text-right tabular-nums">
                    {formatMoney(processed)}
                    {s?.last_paid_at ? <p className="text-xs p-muted">last {formatDate(s.last_paid_at, "UTC", "MMM d")}</p> : null}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(fees)}</td>
                  <td className="whitespace-nowrap">{formatDate(b.created_at, "UTC")}</td>
                  <td className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {b.status === "suspended" ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}
                      <StatusButton id={b.id} name={b.name} status={b.status} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center p-muted">
                  {q || filter !== "all" ? "No businesses match." : "No businesses yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
          <span className="p-muted">
            Page {page} of {pages} · {count} businesses
          </span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-full border p-line px-3 py-1.5">Previous</Link> : null}
            {page < pages ? <Link href={href({ page: page + 1 })} className="rounded-full border p-line px-3 py-1.5">Next</Link> : null}
          </span>
        </nav>
      ) : null}
    </Section>
  );
}
