import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, cn } from "@/components/ui";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { filtersToQuery, hasActiveFilters, ownerScope, parseLeadFilters, type LeadFilters, type OwnerFilter } from "@/lib/leads/filters";
import { LEAD_SOURCES, LEAD_STATUSES, SOURCE_LABELS, STATUS_LABELS, optionLabel, type LeadStatus } from "@/lib/leads/options";
import { formatDate } from "@/lib/format";
import { fetchLeads, scoped } from "./query";
import { QuickAddLead } from "./quick-add";
import { FollowUp, LeadCard, isPast, ScoreBadge, StatusBadge, leadName, sourceLabel, type LeadRow } from "./lead-ui";
import { moveLead } from "./actions";

export const metadata: Metadata = { title: "Leads" };

const BOARD: LeadStatus[] = ["new", "contacted", "consult_booked", "nurturing", "converted"];
const NEXT: Partial<Record<LeadStatus, LeadStatus>> = { new: "contacted", contacted: "consult_booked", consult_booked: "converted", nurturing: "consult_booked" };

export default async function LeadsPage({ searchParams }: PageProps<"/coach/leads">) {
  const { profile, business, membership } = await requireStaff();
  const filters = parseLeadFilters(await searchParams);
  const supabase = await createClient();
  const manager = isManager(membership);
  const owner = ownerScope(filters, manager);
  const scope = { businessId: business.id, userId: profile.id, owner };
  const tz = profile.timezone;

  const [{ data: leads, error }, { data: statusRows }, { data: magnets }, { data: campaignRows }, { data: team }] = await Promise.all([
    fetchLeads(scope, filters, tz),
    scoped(supabase.from("leads").select("status, next_follow_up_at").eq("business_id", business.id), scope).limit(10000),
    supabase.from("lead_magnets").select("id, title").eq("business_id", business.id).order("created_at", { ascending: false }),
    supabase.from("leads").select("utm_campaign").eq("business_id", business.id).not("utm_campaign", "is", null).limit(5000),
    supabase
      .from("business_members")
      .select("user_id, profiles!business_members_user_id_fkey(full_name, email)")
      .eq("business_id", business.id),
  ]);
  const teamNames = new Map((team ?? []).map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || "Teammate"]));
  const solo = (team ?? []).length <= 1;
  const assigneeOf = (l: LeadRow) => (solo || owner === "mine" ? undefined : l.assigned_coach_id ? (teamNames.get(l.assigned_coach_id) ?? null) : null);
  const rows = (leads ?? []) as LeadRow[];
  const counts = new Map<string, number>();
  let dueCount = 0;
  for (const r of statusRows ?? []) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (r.next_follow_up_at && isPast(r.next_follow_up_at) && !["converted", "lost", "unsubscribed"].includes(r.status)) dueCount++;
  }
  const total = statusRows?.length ?? 0;
  const campaigns = [...new Set((campaignRows ?? []).map((r) => r.utm_campaign!).filter(Boolean))].sort();
  const magnetTitles = new Map((magnets ?? []).map((m) => [m.id, m.title]));
  const active = hasActiveFilters(filters);
  const showBoard = !filters.status;
  const link = (patch: Partial<LeadFilters>) => `/coach/leads${filtersToQuery({ ...filters, owner, ...patch })}`;
  const exportHref = `/coach/leads/export${filtersToQuery({ ...filters, owner })}`;
  const OWNER_TABS: { value: OwnerFilter; label: string }[] = [
    { value: "mine", label: "My leads" },
    { value: "all", label: "Everyone" },
    { value: "unassigned", label: "Unassigned" },
  ];
  const converted = counts.get("converted") ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description={`${total} total · ${converted} converted${total ? ` (${Math.round((converted / total) * 100)}%)` : ""}`}
        actions={
          <>
            <LinkButton href="/coach/lead-magnets" variant="outline" size="sm">
              Lead magnets
            </LinkButton>
            <a href={exportHref} className="inline-flex h-8 items-center rounded-full border border-zinc-300 bg-white px-3 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
              Export CSV
            </a>
          </>
        }
      />

      {/* Whose leads (teams only) */}
      {solo ? null : (
        <nav aria-label="Lead owner" className="inline-flex rounded-full border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
          {OWNER_TABS.map((t) => (
            <Link
              key={t.value}
              href={link({ owner: t.value })}
              aria-current={owner === t.value ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                owner === t.value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {/* Status counts */}
      <nav aria-label="Lead status" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <StatusPill href={link({ status: undefined })} active={!filters.status} label="All" count={total} />
        {LEAD_STATUSES.map((s) => (
          <StatusPill key={s} href={link({ status: s })} active={filters.status === s} label={STATUS_LABELS[s]} count={counts.get(s) ?? 0} />
        ))}
        <StatusPill
          href={link({ due: filters.due === "overdue" ? undefined : "overdue" })}
          active={filters.due === "overdue"}
          label="Follow-up due"
          count={dueCount}
          tone="red"
        />
      </nav>

      <QuickAddLead />

      {/* Filters (plain GET form: works without JS) */}
      <form method="get" className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-900">
        {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
        <input type="hidden" name="owner" value={owner} />
        <label className="sr-only" htmlFor="lf-q">Search</label>
        <Input id="lf-q" name="q" defaultValue={filters.q} placeholder="Search name, email, phone…" className="lg:col-span-2" />
        <label className="sr-only" htmlFor="lf-source">Source</label>
        <Select id="lf-source" name="source" defaultValue={filters.source ?? ""}>
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="lf-magnet">Lead magnet</label>
        <Select id="lf-magnet" name="magnet" defaultValue={filters.magnet ?? ""}>
          <option value="">All magnets</option>
          {(magnets ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="lf-campaign">Campaign</label>
        <Select id="lf-campaign" name="campaign" defaultValue={filters.campaign ?? ""}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="lf-due">Follow-up</label>
        <Select id="lf-due" name="due" defaultValue={filters.due ?? ""}>
          <option value="">Any follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="none">No follow-up set</option>
        </Select>
        <label className="sr-only" htmlFor="lf-sort">Sort</label>
        <Select id="lf-sort" name="sort" defaultValue={filters.sort}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score">Highest score</option>
          <option value="follow_up">Next follow-up</option>
          <option value="name">Name A–Z</option>
        </Select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5 lg:justify-end">
          {active ? (
            <LinkButton href={`/coach/leads?owner=${owner}`} variant="ghost" size="md">
              Clear
            </LinkButton>
          ) : null}
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-600">Couldn&apos;t load leads: {error.message}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          title={active ? "No leads match these filters" : "No leads yet"}
          description={
            active
              ? "Try clearing a filter or searching for something else."
              : owner === "mine" && !solo
                ? "Leads assigned to you show up here. Switch to Everyone to see the whole team's pipeline."
                : "Share a free guide or your homepage to start capturing leads. New sign-ups, contact form messages and consult bookings all land here."
          }
          action={
            active ? (
              <LinkButton href={`/coach/leads?owner=${owner}`} variant="outline">
                Clear filters
              </LinkButton>
            ) : (
              <LinkButton href="/coach/lead-magnets">Set up a lead magnet</LinkButton>
            )
          }
        />
      ) : (
        <>
          {/* Desktop: board (or table when a status is selected) */}
          {showBoard ? (
            <div className="hidden gap-4 lg:grid lg:grid-cols-5">
              {BOARD.map((status) => {
                const col = rows.filter((r) => r.status === status);
                return (
                  <section key={status} aria-label={STATUS_LABELS[status]} className="flex min-w-0 flex-col rounded-2xl bg-zinc-100/70 p-2 dark:bg-zinc-900/60">
                    <header className="flex items-center justify-between px-2 py-1.5">
                      <h2 className="text-sm font-semibold">{STATUS_LABELS[status]}</h2>
                      <Badge>{col.length}</Badge>
                    </header>
                    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-0.5">
                      {col.length ? (
                        col.map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            timeZone={tz}
                            magnetTitle={lead.lead_magnet_id ? magnetTitles.get(lead.lead_magnet_id) : undefined}
                            assignee={assigneeOf(lead)}
                            footer={
                              NEXT[status] ? (
                                <form action={moveLead} className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                                  <input type="hidden" name="lead_id" value={lead.id} />
                                  <input type="hidden" name="status" value={NEXT[status]} />
                                  <button className="text-xs font-semibold text-zinc-500 hover:text-brand">
                                    Move to {STATUS_LABELS[NEXT[status]!]} →
                                  </button>
                                </form>
                              ) : null
                            }
                          />
                        ))
                      ) : (
                        <p className="px-2 py-6 text-center text-xs text-zinc-400">Nothing here</p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="hidden lg:block">
              <Table>
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Source</th>
                    <th>Goal</th>
                    {solo ? null : <th>Coach</th>}
                    <th>Follow-up</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link href={`/coach/leads/${lead.id}`} className="font-semibold hover:text-brand">
                          {leadName(lead)}
                        </Link>
                        <p className="text-xs text-zinc-500">{lead.email}</p>
                      </td>
                      <td>
                        <StatusBadge status={lead.status} />
                      </td>
                      <td>
                        <ScoreBadge score={lead.score} />
                      </td>
                      <td className="text-xs">
                        {(lead.lead_magnet_id && magnetTitles.get(lead.lead_magnet_id)) || sourceLabel(lead.source)}
                        {lead.utm_campaign ? <p className="text-zinc-500">{lead.utm_campaign}</p> : null}
                      </td>
                      <td className="text-xs">{optionLabel(lead.primary_goal)}</td>
                      {solo ? null : (
                        <td className="text-xs">{lead.assigned_coach_id ? teamNames.get(lead.assigned_coach_id) : <span className="text-amber-600">Unassigned</span>}</td>
                      )}
                      <td>
                        <FollowUp at={lead.next_follow_up_at} timeZone={tz} />
                      </td>
                      <td className="text-xs text-zinc-500">{formatDate(lead.created_at, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {/* Mobile: list */}
          <ul className={cn("flex flex-col gap-2 lg:hidden")}>
            {rows.map((lead) => (
              <li key={lead.id}>
                <LeadCard
                  lead={lead}
                  timeZone={tz}
                  magnetTitle={lead.lead_magnet_id ? magnetTitles.get(lead.lead_magnet_id) : undefined}
                  assignee={assigneeOf(lead)}
                  footer={
                    <div className="mt-2">
                      <StatusBadge status={lead.status} />
                    </div>
                  }
                />
              </li>
            ))}
          </ul>
          {rows.length >= 500 ? (
            <Card className="text-sm text-zinc-500">Showing the first 500 leads. Use search or filters to narrow down, or export to CSV.</Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusPill({ href, active, label, count, tone }: { href: string; active: boolean; label: string; count: number; tone?: "red" }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand text-on-brand"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs font-bold tabular-nums",
          active ? "bg-white/20" : tone === "red" && count ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-zinc-100 dark:bg-zinc-800",
        )}
      >
        {count}
      </span>
    </Link>
  );
}
