import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { ActionButton } from "@/components/payments/action-button";
import { RevenueChart } from "@/components/payments/revenue-chart";
import { Alert, Badge, Button, Card, CardTitle, Checkbox, EmptyState, Field, Input, LinkButton, PageHeader, Select, Stat, Table, Textarea, buttonClass } from "@/components/ui";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDate, formatMoney, titleCase } from "@/lib/format";
import { loadCommissionReport } from "@/lib/payments/commissions";
import { feePercentLabel } from "@/lib/payments/fees";
import { PAYMENT_STATUS_TONE, PURPOSE_LABEL, SUBSCRIPTION_STATUS_TONE } from "@/lib/payments/format";
import { connectStatus, lastMonths, monthStartUtc, monthlyRecurringCents, refundableCents, revenueByMonth } from "@/lib/payments/mapping";
import { commissionTotals, parseDateRange } from "@/lib/payments/report";
import type { Database } from "@/lib/supabase/database.types";
import { adjustCreditsAction, chargeClientAction, refundPaymentAction, setSubscriptionCancelAction } from "./actions";

export const metadata = { title: "Payments" };

type Status = Database["public"]["Enums"]["payment_status"];
type Purpose = Database["public"]["Enums"]["payment_purpose"];
const STATUSES: Status[] = ["succeeded", "pending", "partially_refunded", "refunded", "failed", "cancelled"];
const PURPOSES: Purpose[] = ["booking", "package", "subscription", "one_time", "invoice", "fee", "tip"];
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f-]{36}$/i;

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function PaymentsPage({ searchParams }: PageProps<"/coach/payments">) {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const tz = business.timezone;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === one(sp.status));
  const purpose = PURPOSES.find((p) => p === one(sp.purpose));
  const clientFilter = one(sp.client)?.match(UUID) ? one(sp.client) : undefined;
  // Coaches only ever see payments attributed to them (RLS enforces it too).
  const coachFilter = manager ? (one(sp.coach)?.match(UUID) ? one(sp.coach) : undefined) : profile.id;
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const range = parseDateRange({ from: one(sp.from), to: one(sp.to) }, tz);

  const now = new Date();
  const months = lastMonths(now, tz, 12);
  const since = monthStartUtc(months[0]!, tz).toISOString();
  const supabase = await createClient();

  let listQuery = supabase
    .from("payments")
    .select("*, client:profiles!payments_client_id_fkey(full_name, email), coach:profiles!payments_coach_id_fkey(full_name, email)", { count: "exact" })
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) listQuery = listQuery.eq("status", status);
  if (purpose) listQuery = listQuery.eq("purpose", purpose);
  if (clientFilter) listQuery = listQuery.eq("client_id", clientFilter);
  if (coachFilter) listQuery = listQuery.eq("coach_id", coachFilter);

  let revenueQuery = supabase
    .from("payments")
    .select("paid_at, amount_cents, amount_refunded_cents, status, currency")
    .eq("business_id", business.id)
    .gte("paid_at", since)
    .in("status", ["succeeded", "partially_refunded", "refunded"]);
  if (!manager) revenueQuery = revenueQuery.eq("coach_id", profile.id);

  let subsQuery = supabase
    .from("subscriptions")
    .select("*, client:profiles!subscriptions_client_id_fkey(full_name, email), offering:offerings(name, price_cents, currency, billing_interval, interval_count)")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });
  if (!manager) subsQuery = subsQuery.eq("coach_id", profile.id);

  const [
    { data: revenueRows },
    { data: payments, count },
    { data: subs },
    { data: outstanding },
    { data: roster },
    { data: sessionTypes },
    { data: team },
    commissions,
  ] = await Promise.all([
    revenueQuery,
    listQuery,
    subsQuery,
    manager ? supabase.rpc("outstanding_credits", { p_business: business.id }) : Promise.resolve({ data: null }),
    manager
      ? supabase
          .from("business_clients")
          .select("client_id, status, profile:profiles!business_clients_client_id_fkey(full_name, email)")
          .eq("business_id", business.id)
          .neq("status", "archived")
      : Promise.resolve({ data: [] }),
    manager
      ? supabase.from("session_types").select("id, name").eq("business_id", business.id).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [] }),
    manager
      ? supabase
          .from("business_members")
          .select("user_id, role, active, profile:profiles!business_members_user_id_fkey(full_name, email)")
          .eq("business_id", business.id)
      : Promise.resolve({ data: [] }),
    loadCommissionReport(supabase, business.id, range),
  ]);

  const currency = revenueRows?.[0]?.currency ?? "usd";
  const byMonth = revenueByMonth(revenueRows ?? [], tz, now, 12);
  const thisMonth = byMonth.at(-1)?.cents ?? 0;
  const lastMonth = byMonth.at(-2)?.cents ?? 0;
  const activeSubs = (subs ?? []).filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due");
  const mrr = activeSubs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .reduce((sum, s) => sum + (s.offering ? monthlyRecurringCents(s.offering.price_cents, s.offering.billing_interval, s.offering.interval_count) : 0), 0);
  const subscribers = new Set(activeSubs.map((s) => s.client_id)).size;
  const clients = (roster ?? [])
    .map((r) => ({ id: r.client_id, name: displayName(r.profile) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const coaches = (team ?? [])
    .filter((m) => m.active)
    .map((m) => ({ id: m.user_id, name: displayName(m.profile) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const change = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
  const totals = commissionTotals(commissions);
  const stripeState = connectStatus(business);
  const canCharge = Boolean(business.stripe_account_id && business.stripe_charges_enabled);

  const qs = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, purpose, client: clientFilter, coach: manager ? coachFilter : undefined, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "page" && v === "1")) p.set(k, v);
    const s = p.toString();
    return `/coach/payments${s ? `?${s}` : ""}#payments`;
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={manager ? "Payments" : "My payments"}
        description={
          manager
            ? "Revenue, refunds, invoices, credits, memberships and revenue by coach."
            : "Payments attributed to you: your sessions and your clients' purchases."
        }
        actions={
          manager ? (
            <>
              <LinkButton href="/coach/payments/setup" variant="outline">Stripe setup</LinkButton>
              <LinkButton href="/coach/payments/plan" variant="outline">
                Plan: {business.plan === "pro" ? "Pro" : "Starter"}
              </LinkButton>
            </>
          ) : null
        }
      />

      {manager && stripeState !== "active" ? (
        <Alert tone="amber">
          {stripeState === "not_connected"
            ? "Connect your Stripe account to take payments online."
            : stripeState === "onboarding"
              ? "Finish your Stripe onboarding to start taking payments."
              : "Stripe needs more information before payments or payouts are fully enabled."}{" "}
          <Link href="/coach/payments/setup" className="font-semibold underline">Go to setup</Link>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="This month"
          value={formatMoney(thisMonth, currency)}
          hint={change === null ? "Net of refunds" : `${change >= 0 ? "+" : ""}${change}% vs last month`}
        />
        <Stat label="Last month" value={formatMoney(lastMonth, currency)} />
        <Stat label="MRR" value={formatMoney(mrr, currency)} hint="From active memberships" />
        <Stat label="Active members" value={subscribers} hint={`${activeSubs.filter((s) => s.status === "trialing").length} on trial`} />
        {manager ? (
          <Stat label="Outstanding credits" value={outstanding ?? 0} hint="Unused, unexpired" />
        ) : (
          <Stat label="Payments" value={count ?? 0} hint="Attributed to you" />
        )}
      </div>

      <Card>
        <CardTitle className="mb-3">Revenue, last 12 months</CardTitle>
        {byMonth.some((m) => m.cents > 0) ? (
          <RevenueChart data={byMonth} currency={currency} />
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">No revenue yet. Paid sessions, packages and memberships will show up here.</p>
        )}
      </Card>

      <section id="commissions" aria-labelledby="commissions-title" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="commissions-title" className="text-lg font-semibold tracking-tight">{manager ? "Revenue by coach" : "My revenue"}</h2>
            <p className="text-sm text-zinc-500">
              Paid in the range, net of refunds. Sessions count for the coach who ran them; purchases for the client&apos;s primary coach.
            </p>
          </div>
          <a
            href={`/coach/payments/commissions?from=${range.from}&to=${range.to}`}
            className={buttonClass("outline", "sm")}
          >
            Export CSV
          </a>
        </div>
        <form method="get" action="/coach/payments#commissions" className="flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="c-from">
            <Input id="c-from" name="from" type="date" defaultValue={range.from} className="w-44" />
          </Field>
          <Field label="To" htmlFor="c-to">
            <Input id="c-to" name="to" type="date" defaultValue={range.to} className="w-44" />
          </Field>
          <Button type="submit" variant="outline">Update</Button>
        </form>
        {commissions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            No paid revenue from {range.from} to {range.to}.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Coach</th>
                <th className="text-right">Payments</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Refunded</th>
                <th className="text-right">Net</th>
                {manager ? <th className="text-right">Platform fees</th> : null}
                {manager ? <th className="text-right">Share</th> : null}
              </tr>
            </thead>
            <tbody>
              {commissions.map((l) => (
                <tr key={l.coachId ?? "unassigned"}>
                  <td className="font-medium">
                    {l.coachId && manager ? (
                      <Link href={qs({ coach: l.coachId, page: "1" })} className="hover:text-brand">{l.coachName}</Link>
                    ) : (
                      l.coachName
                    )}
                  </td>
                  <td className="text-right tabular-nums">{l.payments}</td>
                  <td className="text-right tabular-nums">{formatMoney(l.grossCents, currency)}</td>
                  <td className="text-right tabular-nums">{l.refundedCents ? `−${formatMoney(l.refundedCents, currency)}` : "–"}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(l.netCents, currency)}</td>
                  {manager ? <td className="text-right tabular-nums">{l.platformFeeCents ? formatMoney(l.platformFeeCents, currency) : "–"}</td> : null}
                  {manager ? <td className="text-right tabular-nums">{Math.round(l.share * 100)}%</td> : null}
                </tr>
              ))}
              {manager && commissions.length > 1 ? (
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right tabular-nums">{totals.payments}</td>
                  <td className="text-right tabular-nums">{formatMoney(totals.grossCents, currency)}</td>
                  <td className="text-right tabular-nums">{totals.refundedCents ? `−${formatMoney(totals.refundedCents, currency)}` : "–"}</td>
                  <td className="text-right tabular-nums">{formatMoney(totals.netCents, currency)}</td>
                  <td className="text-right tabular-nums">{totals.platformFeeCents ? formatMoney(totals.platformFeeCents, currency) : "–"}</td>
                  <td className="text-right tabular-nums">100%</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        )}
        {manager && business.plan === "starter" ? (
          <p className="text-xs text-zinc-500">
            On the Starter plan a {feePercentLabel(business.platform_fee_bps)} platform fee applies to online payments.{" "}
            <Link href="/coach/payments/plan" className="underline">Compare plans</Link>
          </p>
        ) : null}
      </section>

      {manager ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Charge a client</CardTitle>
            <p className="mb-4 mt-1 text-sm text-zinc-500">Emails an invoice they can pay online by card.</p>
            {!canCharge ? (
              <p className="text-sm text-zinc-500">
                <Link href="/coach/payments/setup" className="font-semibold text-brand">Connect Stripe</Link> to send invoices.
              </p>
            ) : clients.length ? (
              <ActionForm action={chargeClientAction} resetOnSuccess className="flex flex-col gap-3">
                <Field label="Client" htmlFor="charge-client">
                  <Select id="charge-client" name="client_id" required defaultValue="">
                    <option value="" disabled>Choose a client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount ($)" htmlFor="charge-amount">
                    <Input id="charge-amount" name="amount" type="number" inputMode="decimal" min="0.5" step="0.01" required />
                  </Field>
                  <Field label="Due in (days)" htmlFor="charge-due">
                    <Input id="charge-due" name="days_until_due" type="number" min={0} max={90} defaultValue={7} />
                  </Field>
                </div>
                {coaches.length > 1 ? (
                  <Field label="Credit to coach" htmlFor="charge-coach" hint="Blank = the client's primary coach">
                    <Select id="charge-coach" name="coach_id" defaultValue="">
                      <option value="">Client&apos;s primary coach</option>
                      {coaches.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Description" htmlFor="charge-desc">
                  <Textarea id="charge-desc" name="description" rows={2} maxLength={250} required placeholder="Nutrition plan add-on" />
                </Field>
                <div>
                  <SubmitButton pendingLabel="Creating invoice…">Send invoice</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-500">Add clients first to bill them.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Grant or remove credits</CardTitle>
            <p className="mb-4 mt-1 text-sm text-zinc-500">Use a negative number to remove unused credits (earliest-expiring first).</p>
            {clients.length ? (
              <ActionForm action={adjustCreditsAction} resetOnSuccess className="flex flex-col gap-3">
                <Field label="Client" htmlFor="credit-client">
                  <Select id="credit-client" name="client_id" required defaultValue="">
                    <option value="" disabled>Choose a client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Credits (+/−)" htmlFor="credit-amount">
                    <Input id="credit-amount" name="amount" type="number" min={-1000} max={1000} step={1} required />
                  </Field>
                  <Field label="Expire after (days)" htmlFor="credit-exp" hint="Blank = never">
                    <Input id="credit-exp" name="expires_days" type="number" min={1} max={3650} />
                  </Field>
                </div>
                {sessionTypes?.length ? (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Valid for (new credits; none = any)</legend>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {sessionTypes.map((st) => (
                        <Checkbox key={st.id} name="session_type_ids[]" value={st.id} label={st.name} />
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <Field label="Note" htmlFor="credit-note">
                  <Input id="credit-note" name="note" maxLength={200} placeholder="Make-up session" />
                </Field>
                <div>
                  <SubmitButton>Apply</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-500">Add clients first to grant credits.</p>
            )}
          </Card>
        </div>
      ) : null}

      <section id="payments" aria-labelledby="payments-title" className="flex scroll-mt-20 flex-col gap-3">
        <h2 id="payments-title" className="text-lg font-semibold tracking-tight">Payments</h2>
        <form method="get" action="/coach/payments#payments" className="flex flex-wrap items-end gap-2">
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" name="status" defaultValue={status ?? ""} className="w-44">
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{titleCase(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="f-purpose">
            <Select id="f-purpose" name="purpose" defaultValue={purpose ?? ""} className="w-40">
              <option value="">Any type</option>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
          {manager ? (
            <>
              <Field label="Client" htmlFor="f-client">
                <Select id="f-client" name="client" defaultValue={clientFilter ?? ""} className="w-48">
                  <option value="">All clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              {coaches.length > 1 ? (
                <Field label="Coach" htmlFor="f-coach">
                  <Select id="f-coach" name="coach" defaultValue={coachFilter ?? ""} className="w-44">
                    <option value="">All coaches</option>
                    {coaches.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}
          <Button type="submit" variant="outline">Filter</Button>
          {status || purpose || clientFilter || (manager && coachFilter) ? (
            <Link href="/coach/payments#payments" className={buttonClass("ghost")}>Clear</Link>
          ) : null}
        </form>

        {!payments?.length ? (
          <EmptyState
            title={status || purpose || clientFilter || (manager && coachFilter) ? "No payments match these filters" : "No payments yet"}
            description="Session payments, package and membership purchases, invoices and fees will be listed here."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Description</th>
                  {manager && coaches.length > 1 ? <th>Coach</th> : null}
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const refundable = manager ? refundableCents(p) : 0;
                  const isPackage = p.purpose === "package" || p.purpose === "subscription";
                  return (
                    <tr key={p.id} className="align-top">
                      <td className="whitespace-nowrap">{formatDate(p.paid_at ?? p.created_at, tz)}</td>
                      <td>
                        {p.client_id ? (
                          <Link href={`/coach/clients/${p.client_id}`} className="font-medium hover:text-brand">
                            {displayName(p.client)}
                          </Link>
                        ) : (
                          <span className="text-zinc-500">{p.payer_email ?? "Guest"}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <span>{p.description ?? PURPOSE_LABEL[p.purpose]}</span>
                          <span><Badge>{PURPOSE_LABEL[p.purpose]}</Badge></span>
                        </div>
                      </td>
                      {manager && coaches.length > 1 ? (
                        <td className="whitespace-nowrap text-sm">{p.coach_id ? displayName(p.coach) : <span className="text-zinc-500">Unassigned</span>}</td>
                      ) : null}
                      <td className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatMoney(p.amount_cents, p.currency)}
                        {p.amount_refunded_cents > 0 ? (
                          <div className="text-xs font-normal text-zinc-500">−{formatMoney(p.amount_refunded_cents, p.currency)} refunded</div>
                        ) : null}
                        {manager && p.platform_fee_cents > 0 ? (
                          <div className="text-xs font-normal text-zinc-500">{formatMoney(p.platform_fee_cents, p.currency)} platform fee</div>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{titleCase(p.status)}</Badge>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1 text-sm">
                          {p.receipt_url ? (
                            <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Receipt</a>
                          ) : null}
                          {p.hosted_invoice_url ? (
                            <a href={p.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Invoice</a>
                          ) : null}
                          {refundable > 0 ? (
                            <details className="w-56">
                              <summary className="cursor-pointer text-zinc-600 hover:text-brand dark:text-zinc-400">Refund…</summary>
                              <ActionForm action={refundPaymentAction} className="mt-2 flex flex-col gap-2">
                                <input type="hidden" name="payment_id" value={p.id} />
                                <Field label={`Amount (max ${formatMoney(refundable, p.currency)})`} htmlFor={`r-${p.id}`} hint="Blank = full remaining amount">
                                  <Input id={`r-${p.id}`} name="amount" type="number" min="0.01" step="0.01" max={(refundable / 100).toFixed(2)} />
                                </Field>
                                <Input name="reason" placeholder="Reason (optional)" aria-label="Reason" maxLength={200} />
                                {isPackage ? <Checkbox name="revoke_credits" label="Also remove unused credits from this purchase" /> : null}
                                <SubmitButton size="sm" variant="danger" pendingLabel="Refunding…">Refund</SubmitButton>
                              </ActionForm>
                            </details>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {pages > 1 ? (
              <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
                {page > 1 ? <Link href={qs({ page: String(page - 1) })} className={buttonClass("outline", "sm")}>← Newer</Link> : <span />}
                <span className="text-zinc-500">Page {page} of {pages}</span>
                {page < pages ? <Link href={qs({ page: String(page + 1) })} className={buttonClass("outline", "sm")}>Older →</Link> : <span />}
              </nav>
            ) : null}
          </>
        )}
      </section>

      <section id="subscriptions" aria-labelledby="subs-title" className="flex scroll-mt-20 flex-col gap-3">
        <h2 id="subs-title" className="text-lg font-semibold tracking-tight">Memberships</h2>
        {!subs?.length ? (
          <EmptyState
            title="No memberships yet"
            description="When clients subscribe to a membership plan, they'll appear here."
            action={manager ? <Link href="/coach/offerings/new" className={buttonClass("outline")}>Create a membership</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Renews / ends</th>
                {manager ? <th><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => {
                const ended = s.status === "canceled" || s.status === "incomplete_expired";
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/coach/clients/${s.client_id}`} className="font-medium hover:text-brand">{displayName(s.client)}</Link>
                    </td>
                    <td>{s.offering?.name ?? "Membership"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status] ?? "neutral"}>{titleCase(s.status)}</Badge>
                        {s.cancel_at_period_end ? <Badge tone="amber">Cancels at period end</Badge> : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {ended
                        ? s.canceled_at ? `Ended ${formatDate(s.canceled_at, tz)}` : "Ended"
                        : s.current_period_end
                          ? `${s.cancel_at_period_end ? "Ends" : "Renews"} ${formatDate(s.current_period_end, tz)}`
                          : "–"}
                      {s.status === "trialing" && s.trial_end ? <div className="text-xs text-zinc-500">Trial ends {formatDate(s.trial_end, tz)}</div> : null}
                    </td>
                    {manager ? (
                      <td>
                        {ended ? null : s.cancel_at_period_end ? (
                          <ActionButton action={setSubscriptionCancelAction} fields={{ subscription_id: s.id, cancel: "false" }} variant="ghost">
                            Resume
                          </ActionButton>
                        ) : (
                          <ActionButton
                            action={setSubscriptionCancelAction}
                            fields={{ subscription_id: s.id, cancel: "true" }}
                            variant="ghost"
                            confirm="Cancel this membership at the end of the current period?"
                          >
                            Cancel at period end
                          </ActionButton>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
