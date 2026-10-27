import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { ActionButton } from "@/components/payments/action-button";
import { Alert, Badge, Card, CardTitle, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { creditGrantsRemaining } from "@/lib/payments/credits";
import { PAYMENT_STATUS_TONE, PURPOSE_LABEL, SUBSCRIPTION_STATUS_TONE, priceLabel } from "@/lib/payments/format";
import { openBillingPortal, setMySubscriptionCancel } from "./actions";

export const metadata = { title: "Billing & credits" };

export default async function BillingPage({ searchParams }: PageProps<"/me/billing">) {
  const profile = await requireClient();
  const tz = profile.timezone;
  const { notice } = await searchParams;
  const supabase = await createClient();

  const [grants, { data: subs }, { data: payments }, { data: sessionTypes }] = await Promise.all([
    creditGrantsRemaining(supabase, profile.id),
    supabase
      .from("subscriptions")
      .select("*")
      .eq("client_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("*")
      .eq("client_id", profile.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("session_types").select("id, name, allow_credits, active").order("sort_order"),
  ]);

  // Offerings referenced by purchases may be hidden now, so read them with the service role.
  const offeringIds = [...new Set([...(subs ?? []).map((s) => s.offering_id), ...(payments ?? []).map((p) => p.offering_id)].filter((x): x is string => Boolean(x)))];
  const { data: offerings } = offeringIds.length
    ? await createAdminClient()
        .from("offerings")
        .select("id, name, kind, price_cents, currency, billing_interval, interval_count, credits, digital_file_path, digital_file_name")
        .in("id", offeringIds)
    : { data: [] };
  const offeringById = new Map((offerings ?? []).map((o) => [o.id, o]));
  const typeName = new Map((sessionTypes ?? []).map((s) => [s.id, s.name]));

  const live = (grants ?? []).filter((g) => g.remaining > 0);
  const totalCredits = live.reduce((s, g) => s + g.remaining, 0);
  // Balance per bookable session type (a grant counts if unrestricted or includes the type).
  const balances = (sessionTypes ?? [])
    .filter((st) => st.active && st.allow_credits)
    .map((st) => ({
      id: st.id,
      name: st.name,
      balance: live.filter((g) => !g.session_type_ids?.length || g.session_type_ids.includes(st.id)).reduce((s, g) => s + g.remaining, 0),
    }))
    .filter((b) => b.balance > 0);
  const nextExpiry = live.filter((g) => g.expires_at).sort((a, b) => a.expires_at!.localeCompare(b.expires_at!))[0];

  const activeSubs = (subs ?? []).filter((s) => s.status !== "canceled" && s.status !== "incomplete_expired");
  const pastSubs = (subs ?? []).filter((s) => s.status === "canceled" || s.status === "incomplete_expired");
  const downloads = (payments ?? []).filter(
    (p) =>
      p.purpose === "one_time" &&
      (p.status === "succeeded" || p.status === "partially_refunded") &&
      p.offering_id &&
      offeringById.get(p.offering_id)?.digital_file_path,
  );
  const openInvoices = (payments ?? []).filter((p) => p.status === "pending" && p.hosted_invoice_url);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing & credits"
        description="Your session credits, membership, purchases and receipts."
        actions={
          <>
            <ActionForm action={openBillingPortal}>
              <SubmitButton variant="outline" pendingLabel="Opening…">Manage payment methods</SubmitButton>
            </ActionForm>
            <LinkButton href="/pricing">Buy more</LinkButton>
          </>
        }
      />

      {notice === "already_subscribed" ? <Alert tone="amber">You already have that membership. You can manage it below.</Alert> : null}
      {openInvoices.length ? (
        <Alert tone="amber">
          You have {openInvoices.length} unpaid invoice{openInvoices.length === 1 ? "" : "s"}.{" "}
          {openInvoices.map((p, i) => (
            <span key={p.id}>
              {i ? ", " : ""}
              <a href={p.hosted_invoice_url!} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                Pay {formatMoney(p.amount_cents, p.currency)}
              </a>
            </span>
          ))}
        </Alert>
      ) : null}

      <section aria-labelledby="credits-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="credits-title" className="text-lg font-semibold tracking-tight">Session credits</h2>
          {totalCredits > 0 ? <Link href="/me/book" className="text-sm font-semibold text-brand">Book with credits →</Link> : null}
        </div>
        {totalCredits === 0 ? (
          <EmptyState
            title="No session credits"
            description="Buy a session pack or join a membership to get credits you can use when booking."
            action={<LinkButton href="/pricing" variant="outline">See packages</LinkButton>}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {balances.map((b) => (
                <Card key={b.id} className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{b.name}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">{b.balance}</p>
                  <p className="text-xs text-zinc-500">credit{b.balance === 1 ? "" : "s"} available</p>
                </Card>
              ))}
            </div>
            {nextExpiry?.expires_at ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {nextExpiry.remaining} credit{nextExpiry.remaining === 1 ? "" : "s"} expire{nextExpiry.remaining === 1 ? "s" : ""} on{" "}
                <span className="font-semibold">{formatDate(nextExpiry.expires_at, tz)}</span>. Credits are used earliest-expiring first.
              </p>
            ) : null}
            <Table>
              <thead>
                <tr>
                  <th>Credits left</th>
                  <th>From</th>
                  <th>Valid for</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {live.map((g) => (
                  <tr key={g.grant_id}>
                    <td className="font-semibold tabular-nums">
                      {g.remaining} <span className="font-normal text-zinc-500">of {g.granted}</span>
                    </td>
                    <td>{(g.offering_id && offeringById.get(g.offering_id)?.name) || titleCase(g.reason)}</td>
                    <td>{g.session_type_ids?.length ? g.session_type_ids.map((id) => typeName.get(id) ?? "Other").join(", ") : "Any session"}</td>
                    <td className="whitespace-nowrap">{g.expires_at ? formatDate(g.expires_at, tz) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </section>

      <section aria-labelledby="subs-title" className="flex flex-col gap-3">
        <h2 id="subs-title" className="text-lg font-semibold tracking-tight">Membership</h2>
        {activeSubs.length === 0 ? (
          <EmptyState
            title="No active membership"
            description="Memberships include regular sessions and ongoing coaching, billed automatically."
            action={<LinkButton href="/pricing#subscription" variant="outline">View memberships</LinkButton>}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeSubs.map((s) => {
              const o = s.offering_id ? offeringById.get(s.offering_id) : undefined;
              return (
                <Card key={s.id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle>{o?.name ?? "Membership"}</CardTitle>
                      {o ? <p className="text-sm text-zinc-500">{priceLabel(o)}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status] ?? "neutral"}>{s.status === "trialing" ? "Free trial" : titleCase(s.status)}</Badge>
                      {s.cancel_at_period_end ? <Badge tone="amber">Cancelling</Badge> : null}
                    </div>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {s.status === "trialing" && s.trial_end
                      ? `Trial ends ${formatDate(s.trial_end, tz)}${s.cancel_at_period_end ? "; you won't be charged." : ", then billing starts."}`
                      : s.current_period_end
                        ? s.cancel_at_period_end
                          ? `Ends on ${formatDate(s.current_period_end, tz)}. You keep access until then.`
                          : `Renews on ${formatDate(s.current_period_end, tz)}.`
                        : null}
                    {o?.credits ? ` Includes ${o.credits} session credit${o.credits === 1 ? "" : "s"} each period.` : ""}
                  </p>
                  {s.status === "past_due" || s.status === "unpaid" ? (
                    <Alert tone="red">Your last payment failed. Update your payment method to keep your membership.</Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {s.cancel_at_period_end ? (
                      <ActionButton action={setMySubscriptionCancel} fields={{ subscription_id: s.id, cancel: "false" }} variant="primary">
                        Resume membership
                      </ActionButton>
                    ) : (
                      <ActionButton
                        action={setMySubscriptionCancel}
                        fields={{ subscription_id: s.id, cancel: "true" }}
                        confirm="Cancel your membership? It stays active until the end of the current period."
                      >
                        Cancel membership
                      </ActionButton>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {pastSubs.length ? (
          <p className="text-xs text-zinc-500">
            Past memberships:{" "}
            {pastSubs.map((s) => `${(s.offering_id && offeringById.get(s.offering_id)?.name) || "Membership"}${s.canceled_at ? ` (ended ${formatDate(s.canceled_at, tz)})` : ""}`).join(", ")}
          </p>
        ) : null}
      </section>

      <section id="downloads" aria-labelledby="downloads-title" className="flex scroll-mt-20 flex-col gap-3">
        <h2 id="downloads-title" className="text-lg font-semibold tracking-tight">Downloads</h2>
        {downloads.length === 0 ? (
          <EmptyState title="No downloads yet" description="Programs and guides you buy will be available here any time." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {downloads.map((p) => {
              const o = offeringById.get(p.offering_id!)!;
              return (
                <li key={p.id}>
                  <Card className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{o.name}</p>
                      <p className="text-xs text-zinc-500">
                        {o.digital_file_name ?? "File"} · bought {formatDate(p.paid_at ?? p.created_at, tz)}
                      </p>
                    </div>
                    <a href={`/api/downloads/${p.id}`} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                      Download
                    </a>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2 id="history-title" className="text-lg font-semibold tracking-tight">Payment history</h2>
        {!payments?.length ? (
          <EmptyState title="No payments yet" description="Your session payments, purchases and receipts will show up here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th><span className="sr-only">Documents</span></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const pdf = (p.metadata as { invoice_pdf?: string | null } | null)?.invoice_pdf;
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{formatDate(p.paid_at ?? p.created_at, tz)}</td>
                    <td>
                      {p.description ?? PURPOSE_LABEL[p.purpose]}
                      <div className="text-xs text-zinc-500">{PURPOSE_LABEL[p.purpose]}</div>
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {formatMoney(p.amount_cents, p.currency)}
                      {p.amount_refunded_cents > 0 ? (
                        <div className="text-xs text-zinc-500">{formatMoney(p.amount_refunded_cents, p.currency)} refunded</div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{p.status === "pending" && p.hosted_invoice_url ? "Due" : titleCase(p.status)}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        {p.receipt_url ? (
                          <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Receipt</a>
                        ) : null}
                        {p.hosted_invoice_url ? (
                          <a href={p.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            {p.status === "pending" ? "Pay invoice" : "Invoice"}
                          </a>
                        ) : null}
                        {pdf ? (
                          <a href={pdf} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">PDF</a>
                        ) : null}
                      </div>
                    </td>
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
