import type { Metadata } from "next";
import Link from "next/link";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { trainerCreditBalances } from "@/lib/clients/queries";
import { Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table } from "@/components/ui";
import { displayName, formatDate, formatDateTime, titleCase } from "@/lib/format";
import { isLowOnCredits, LIVE_SUBSCRIPTION_STATUSES, localDateString, addDaysToDateString, matchesSearch } from "@/lib/clients/metrics";
import { statusTone, subscriptionTone } from "@/components/clients/status";
import { AddClientForm } from "./add-client-form";

export const metadata: Metadata = { title: "Clients" };

const STATUS_FILTERS = ["current", "active", "paused", "invited", "archived", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default async function ClientsPage({ searchParams }: PageProps<"/coach/clients">) {
  const trainer = await requireTrainer();
  const tz = trainer.timezone;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q);
  const status: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(one(sp.status)) ? (one(sp.status) as StatusFilter) : "current";
  const tag = one(sp.tag);

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const since = addDaysToDateString(localDateString(tz), -365);

  const [{ data: rels }, { data: balances }, { data: upcoming }, { data: logs }, { data: subs }, { data: convos }] = await Promise.all([
    supabase
      .from("trainer_clients")
      .select("client_id, status, tags, started_at, profiles!trainer_clients_client_id_fkey(full_name, email, avatar_url, phone)")
      .eq("trainer_id", trainer.id),
    trainerCreditBalances(supabase, trainer.id).then((data) => ({ data })),
    supabase
      .from("bookings")
      .select("client_id, starts_at")
      .eq("trainer_id", trainer.id)
      .not("client_id", "is", null)
      .in("status", ["confirmed", "pending_payment"])
      .gte("starts_at", nowIso)
      .order("starts_at")
      .limit(2000),
    supabase.from("workout_logs").select("client_id, performed_on").gte("performed_on", since).order("performed_on", { ascending: false }).limit(5000),
    supabase.from("subscriptions").select("client_id, status, created_at").eq("trainer_id", trainer.id).order("created_at", { ascending: false }),
    supabase.from("conversations").select("id, client_id, last_message_at, trainer_last_read_at").eq("trainer_id", trainer.id),
  ]);

  const firstBy = <T extends { client_id: string | null }>(rows: T[] | null) => {
    const m = new Map<string, T>();
    for (const r of rows ?? []) if (r.client_id && !m.has(r.client_id)) m.set(r.client_id, r);
    return m;
  };
  const nextBy = firstBy(upcoming);
  const logBy = firstBy(logs);
  const balanceBy = new Map((balances ?? []).map((b) => [b.client_id, b]));
  const subBy = new Map<string, string>();
  for (const s of subs ?? []) {
    const cur = subBy.get(s.client_id);
    // Prefer a live subscription over a newer cancelled one.
    if (!cur || (!(LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(cur) && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(s.status)))
      subBy.set(s.client_id, s.status);
  }
  const convoBy = new Map((convos ?? []).map((c) => [c.client_id, c]));

  const allTags = [...new Set((rels ?? []).flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b));
  const rows = (rels ?? [])
    .filter((r) => (status === "all" ? true : status === "current" ? r.status !== "archived" : r.status === status))
    .filter((r) => !tag || r.tags.includes(tag))
    .filter((r) => matchesSearch(q, [r.profiles?.full_name, r.profiles?.email, r.profiles?.phone, ...r.tags]))
    .sort((a, b) => displayName(a.profiles).localeCompare(displayName(b.profiles)));
  const counts = {
    active: (rels ?? []).filter((r) => r.status === "active").length,
    total: (rels ?? []).filter((r) => r.status !== "archived").length,
  };

  return (
    <div>
      <PageHeader
        title="Clients"
        description={`${counts.active} active · ${counts.total} current`}
      />

      <details className="group mb-6 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900" open={!rels?.length}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold">
          Add client
          <span aria-hidden className="text-brand transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <AddClientForm />
        </div>
      </details>

      <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" role="search">
        <label htmlFor="q" className="sr-only">Search clients</label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search name, email, phone or tag" className="sm:max-w-xs" />
        <label htmlFor="status" className="sr-only">Status</label>
        <Select id="status" name="status" defaultValue={status} className="sm:w-40">
          <option value="current">Current</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="invited">Invited</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
        <label htmlFor="tag" className="sr-only">Tag</label>
        <Select id="tag" name="tag" defaultValue={tag} className="sm:w-44">
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {q || tag || status !== "current" ? (
          <Link href="/coach/clients" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Clear
          </Link>
        ) : null}
      </form>

      {!rels?.length ? (
        <EmptyState title="No clients yet" description="Add your first client above. They'll get an email invite to set up their account." />
      ) : !rows.length ? (
        <EmptyState title="No matching clients" description="Try a different search, status or tag." />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const bal = balanceBy.get(r.client_id);
              const next = nextBy.get(r.client_id);
              return (
                <li key={r.client_id}>
                  <Link href={`/coach/clients/${r.client_id}`}>
                    <Card className="flex items-center gap-3 p-4">
                      <Avatar name={displayName(r.profiles)} src={r.profiles?.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{displayName(r.profiles)}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {next ? `Next: ${formatDateTime(next.starts_at, tz)}` : "No upcoming session"}
                          {bal && bal.granted > 0 ? ` · ${bal.balance} credits` : ""}
                        </p>
                      </div>
                      <Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Next session</th>
                  <th>Last workout</th>
                  <th>Credits</th>
                  <th>Membership</th>
                  <th>Last message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bal = balanceBy.get(r.client_id);
                  const next = nextBy.get(r.client_id);
                  const log = logBy.get(r.client_id);
                  const sub = subBy.get(r.client_id);
                  const convo = convoBy.get(r.client_id);
                  const unread =
                    convo?.last_message_at && (!convo.trainer_last_read_at || convo.last_message_at > convo.trainer_last_read_at);
                  return (
                    <tr key={r.client_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td>
                        <Link href={`/coach/clients/${r.client_id}`} className="flex items-center gap-3">
                          <Avatar name={displayName(r.profiles)} src={r.profiles?.avatar_url} size={32} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium hover:text-brand">{displayName(r.profiles)}</span>
                            {r.tags.length ? (
                              <span className="block truncate text-xs text-zinc-500">{r.tags.join(" · ")}</span>
                            ) : null}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge>
                      </td>
                      <td className="whitespace-nowrap">{next ? formatDateTime(next.starts_at, tz) : <span className="text-zinc-400">None</span>}</td>
                      <td className="whitespace-nowrap">
                        {log ? formatDate(`${log.performed_on}T12:00:00Z`, "UTC", "MMM d") : <span className="text-zinc-400">Never</span>}
                      </td>
                      <td>
                        {bal && bal.granted > 0 ? (
                          <Badge tone={isLowOnCredits(bal.balance, bal.granted) ? "amber" : "neutral"}>{bal.balance}</Badge>
                        ) : (
                          <span className="text-zinc-400">–</span>
                        )}
                      </td>
                      <td>
                        {sub ? (
                          <Badge tone={subscriptionTone(sub)}>
                            {titleCase(sub)}
                          </Badge>
                        ) : (
                          <span className="text-zinc-400">None</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {convo?.last_message_at ? (
                          <Link href={`/coach/messages/${r.client_id}`} className="inline-flex items-center gap-1.5 hover:text-brand">
                            {unread ? <span className="size-2 rounded-full bg-brand" aria-label="Unread" /> : null}
                            {formatDate(convo.last_message_at, tz, "MMM d")}
                          </Link>
                        ) : (
                          <span className="text-zinc-400">None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
