import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Avatar, Badge, Button, Card, CardTitle, Checkbox, EmptyState, Field, Input, LinkButton, Select, Stat, Textarea, cn } from "@/components/ui";
import { ConfirmButton } from "@/components/clients/confirm-button";
import { statusTone, subscriptionTone } from "@/components/clients/status";
import { ClientTrainingSummary } from "@/components/training/client-training-summary";
import { ClientHabitsGoalsEditor } from "@/components/training/client-habits-goals-editor";
import { displayName, formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { creditBuckets, netPaidCents } from "@/lib/clients/metrics";
import { EXPERIENCE_LEVELS, PARQ_QUESTIONS, PRIMARY_GOALS, labelFor, parqFlags, readParqAnswers } from "@/lib/clients/intake";
import { waiverCurrent } from "@/lib/clients/onboarding";
import type { Tables } from "@/lib/supabase/database.types";
import { addNote, deleteNote, toggleNotePin, updateClientDetails } from "./actions";

export const metadata: Metadata = { title: "Client" };

const TABS = ["overview", "training", "intake", "notes"] as const;
type Tab = (typeof TABS)[number];

const bookingTone = (s: string) =>
  s === "confirmed" || s === "completed" ? "green" : s === "pending_payment" ? "amber" : s === "no_show" || s === "late_cancelled" ? "red" : "neutral";

export default async function ClientDetailPage({ params, searchParams }: PageProps<"/coach/clients/[id]">) {
  const trainer = await requireTrainer();
  const tz = trainer.timezone;
  const { id } = await params;
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview";
  const added = Array.isArray(sp.added) ? sp.added[0] : sp.added;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: rel }, { data: client }] = await Promise.all([
    supabase.from("trainer_clients").select("*").eq("trainer_id", trainer.id).eq("client_id", id).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email, phone, avatar_url, timezone, date_of_birth, created_at, onboarded_at, sms_opt_in, marketing_opt_in").eq("id", id).maybeSingle(),
  ]);
  if (!rel || !client) notFound();

  const { data: intake } = await supabase
    .from("client_intakes")
    .select("*")
    .eq("client_id", id)
    .eq("trainer_id", trainer.id)
    .maybeSingle();

  const name = displayName(client);
  const tabHref = (t: Tab) => `/coach/clients/${id}${t === "overview" ? "" : `?tab=${t}`}`;
  const signed = waiverCurrent(intake);
  const flags = parqFlags(readParqAnswers(intake?.answers));

  return (
    <div className="space-y-6">
      <Link href="/coach/clients" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← All clients
      </Link>

      {added ? (
        <Alert tone="green">
          {added === "invited"
            ? `Invitation sent to ${client.email}. They'll land on their onboarding checklist after accepting.`
            : `${name} already had an account and is now linked to you.`}
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={name} src={client.avatar_url} size={64} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
              <p className="text-sm text-zinc-500">
                <a href={`mailto:${client.email}`} className="hover:text-brand">
                  {client.email}
                </a>
                {client.phone ? (
                  <>
                    {" · "}
                    <a href={`tel:${client.phone}`} className="hover:text-brand">
                      {client.phone}
                    </a>
                  </>
                ) : null}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone(rel.status)}>{titleCase(rel.status)}</Badge>
                <Badge tone={signed ? "green" : "amber"}>{signed ? "Waiver signed" : "No waiver"}</Badge>
                {flags.length ? <Badge tone="red">PAR-Q flags: {flags.length}</Badge> : null}
                {rel.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
                <span className="text-xs text-zinc-500">Client since {formatDate(rel.started_at, tz)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/coach/messages/${id}`} size="sm">
              Message
            </LinkButton>
            <LinkButton href={`/coach/calendar?client=${id}`} size="sm" variant="outline">
              Book session
            </LinkButton>
            <LinkButton href={`/coach/programs?assign=${id}`} size="sm" variant="outline">
              Assign program
            </LinkButton>
            <LinkButton href={`/coach/payments?client=${id}`} size="sm" variant="outline">
              Charge
            </LinkButton>
          </div>
        </div>

        <details className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-semibold">Status, tags & goals</summary>
          <ActionForm action={updateClientDetails.bind(null, id)} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="status" hint="Archived clients lose portal access to booking with you.">
              <Select id="status" name="status" defaultValue={rel.status === "invited" ? "active" : rel.status}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Tags" htmlFor="tags" hint="Comma separated">
              <Input id="tags" name="tags" defaultValue={rel.tags.join(", ")} />
            </Field>
            <Field label="Goals" htmlFor="goals" className="sm:col-span-2">
              <Textarea id="goals" name="goals" defaultValue={rel.goals ?? ""} placeholder="What they want to achieve, by when, and why it matters." />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
        </details>
        {rel.goals ? (
          <p className="mt-4 whitespace-pre-line rounded-xl bg-zinc-50 px-4 py-3 text-sm dark:bg-zinc-800/60">
            <span className="font-semibold">Goals: </span>
            {rel.goals}
          </p>
        ) : null}
      </Card>

      <nav aria-label="Client sections" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium",
              tab === t ? "border-brand text-brand" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {titleCase(t)}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview clientId={id} trainerId={trainer.id} tz={tz} /> : null}
      {tab === "training" ? (
        <div className="space-y-6">
          <ClientTrainingSummary clientId={id} />
          <ClientHabitsGoalsEditor clientId={id} />
        </div>
      ) : null}
      {tab === "intake" ? <IntakeSection intake={intake} tz={tz} /> : null}
      {tab === "notes" ? <Notes clientId={id} trainerId={trainer.id} tz={tz} /> : null}
    </div>
  );
}

async function Overview({ clientId, trainerId, tz }: { clientId: string; trainerId: string; tz: string }) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const bookingCols = "id, starts_at, status, location_type, video_room_url, payment_method, session_types(name)";
  const [{ data: upcoming }, { data: past }, { data: ledger }, { data: types }, { data: subs }, { data: payments }, { count: completedCount }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select(bookingCols)
        .eq("trainer_id", trainerId)
        .eq("client_id", clientId)
        .gte("starts_at", nowIso)
        .in("status", ["confirmed", "pending_payment"])
        .order("starts_at")
        .limit(10),
      supabase
        .from("bookings")
        .select(bookingCols)
        .eq("trainer_id", trainerId)
        .eq("client_id", clientId)
        .lt("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(10),
      supabase.from("credit_ledger").select("id, delta, grant_id, expires_at, session_type_ids").eq("trainer_id", trainerId).eq("client_id", clientId),
      supabase.from("session_types").select("id, name").eq("trainer_id", trainerId),
      supabase
        .from("subscriptions")
        .select("id, status, current_period_end, cancel_at_period_end, trial_end, offerings(name, price_cents, billing_interval, interval_count)")
        .eq("trainer_id", trainerId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("id, status, amount_cents, amount_refunded_cents, currency, description, purpose, paid_at, created_at")
        .eq("trainer_id", trainerId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("trainer_id", trainerId)
        .eq("client_id", clientId)
        .eq("status", "completed"),
    ]);

  const typeName = new Map((types ?? []).map((t) => [t.id, t.name]));
  const buckets = creditBuckets(ledger ?? []);
  const totalCredits = buckets.reduce((s, b) => s + b.remaining, 0);
  const ltv = netPaidCents(payments ?? []);
  const liveSub = (subs ?? []).find((s) => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(s.status));

  const bookingRow = (b: NonNullable<typeof upcoming>[number]) => (
    <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{formatDateTime(b.starts_at, tz)}</p>
        <p className="truncate text-xs text-zinc-500">
          {b.session_types?.name ?? "Session"} · {titleCase(b.location_type)} · {titleCase(b.payment_method)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {b.location_type === "virtual" && b.video_room_url && b.starts_at >= nowIso ? (
          <a href={b.video_room_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand hover:underline">
            Join
          </a>
        ) : null}
        <Badge tone={bookingTone(b.status)}>{titleCase(b.status)}</Badge>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lifetime value" value={formatMoney(ltv)} hint={`${(payments ?? []).filter((p) => p.status === "succeeded" || p.status === "partially_refunded").length} payments`} />
        <Stat label="Sessions done" value={completedCount ?? 0} />
        <Stat label="Credits left" value={totalCredits} hint={buckets.length > 1 ? "across packages" : undefined} />
        <Stat
          label="Membership"
          value={<span className="text-lg">{liveSub ? (liveSub.offerings?.name ?? "Plan") : "None"}</span>}
          hint={liveSub ? titleCase(liveSub.status) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Upcoming sessions</CardTitle>
            <Link href={`/coach/calendar?client=${clientId}`} className="text-sm text-brand hover:underline">
              Book
            </Link>
          </div>
          {upcoming?.length ? (
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">{upcoming.map(bookingRow)}</ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Nothing scheduled.</p>
          )}
        </Card>
        <Card>
          <CardTitle>Past sessions</CardTitle>
          {past?.length ? (
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">{past.map(bookingRow)}</ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No sessions yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>Credits</CardTitle>
          {buckets.length ? (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {buckets.map((b) => (
                <li key={b.sessionTypeIds?.join(",") ?? "any"} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p>{b.sessionTypeIds ? b.sessionTypeIds.map((t) => typeName.get(t) ?? "Removed type").join(", ") : "Any session"}</p>
                    {b.nextExpiry ? <p className="text-xs text-zinc-500">Next expiry {formatDate(b.nextExpiry, tz)}</p> : null}
                  </div>
                  <span className="text-lg font-bold">{b.remaining}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No unused credits.</p>
          )}
        </Card>
        <Card>
          <CardTitle>Subscription</CardTitle>
          {subs?.length ? (
            <ul className="mt-2 space-y-3 text-sm">
              {subs.slice(0, 3).map((s) => (
                <li key={s.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.offerings?.name ?? "Membership"}</span>
                    <Badge tone={subscriptionTone(s.status)}>{titleCase(s.status)}</Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {s.offerings?.price_cents != null && s.offerings.billing_interval
                      ? `${formatMoney(s.offerings.price_cents)} / ${s.offerings.interval_count > 1 ? `${s.offerings.interval_count} ` : ""}${s.offerings.billing_interval}`
                      : null}
                    {s.current_period_end
                      ? ` · ${s.cancel_at_period_end || s.status === "canceled" ? "ends" : "renews"} ${formatDate(s.current_period_end, tz)}`
                      : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No subscription.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Payments</CardTitle>
            <Link href={`/coach/payments?client=${clientId}`} className="text-sm text-brand hover:underline">
              All
            </Link>
          </div>
          {payments?.length ? (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{p.description ?? titleCase(p.purpose)}</p>
                    <p className="text-xs text-zinc-500">{formatDate(p.paid_at ?? p.created_at, tz)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatMoney(p.amount_cents, p.currency)}</p>
                    {p.status !== "succeeded" ? <Badge tone={p.status === "failed" ? "red" : "neutral"}>{titleCase(p.status)}</Badge> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No payments yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function IntakeSection({
  intake,
  tz,
}: {
  intake: Tables<"client_intakes"> | null;
  tz: string;
}) {
  if (!intake) {
    return (
      <EmptyState
        title="No intake yet"
        description="The client fills this in from their portal (Profile & intake). It appears on their onboarding checklist."
      />
    );
  }
  const answers = readParqAnswers(intake.answers);
  const signed = waiverCurrent(intake);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Readiness (PAR-Q)</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">Last updated {formatDateTime(intake.updated_at, tz)}</p>
        <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {PARQ_QUESTIONS.map((q) => {
            const v = answers[q.key];
            return (
              <li key={q.key} className="flex items-start justify-between gap-3 py-2">
                <span>{q.text}</span>
                <Badge tone={v === true ? "red" : v === false ? "green" : "neutral"}>{v === true ? "Yes" : v === false ? "No" : "–"}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardTitle>Background</CardTitle>
          <dl className="mt-3 grid gap-3 text-sm">
            <Item label="Primary goal" value={labelFor(PRIMARY_GOALS, intake.primary_goal)} />
            <Item label="Experience" value={labelFor(EXPERIENCE_LEVELS, intake.experience_level)} />
            <Item label="Injuries & limitations" value={intake.injuries} />
            <Item label="Medications" value={intake.medications} />
            <Item
              label="Emergency contact"
              value={[intake.emergency_contact_name, intake.emergency_contact_phone].filter(Boolean).join(" · ")}
            />
          </dl>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Liability waiver</CardTitle>
            <Badge tone={signed ? "green" : intake.waiver_accepted_at ? "amber" : "red"}>
              {signed ? "Signed" : intake.waiver_accepted_at ? "Outdated version" : "Not signed"}
            </Badge>
          </div>
          {intake.waiver_accepted_at ? (
            <p className="mt-2 text-sm">
              Signed as <span className="font-serif italic">{intake.waiver_signature}</span> on {formatDateTime(intake.waiver_accepted_at, tz)}
              <span className="block text-xs text-zinc-500">Version {intake.waiver_version}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">The client hasn&apos;t signed the waiver yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line">{value || <span className="text-zinc-400">None</span>}</dd>
    </div>
  );
}

async function Notes({ clientId, trainerId, tz }: { clientId: string; trainerId: string; tz: string }) {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("client_notes")
    .select("id, body, pinned, created_at, booking_id")
    .eq("trainer_id", trainerId)
    .eq("client_id", clientId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="h-fit">
        <CardTitle>Add a private note</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">Only you can see notes. Clients never do.</p>
        <ActionForm action={addNote.bind(null, clientId)} resetOnSuccess className="mt-3 space-y-3">
          <label htmlFor="note-body" className="sr-only">Note</label>
          <Textarea id="note-body" name="body" required placeholder="Session observations, preferences, life context…" />
          <Checkbox name="pinned" label="Pin to top" />
          <SubmitButton>Add note</SubmitButton>
        </ActionForm>
      </Card>
      <div>
        {notes?.length ? (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id}>
                <Card className={cn("p-4", n.pinned && "border-brand/40 bg-brand/5 dark:bg-brand/10")}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-zinc-500">
                      {n.pinned ? <Badge tone="brand" className="mr-2">Pinned</Badge> : null}
                      {formatDateTime(n.created_at, tz)}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <form action={toggleNotePin}>
                        <input type="hidden" name="note_id" value={n.id} />
                        <input type="hidden" name="client_id" value={clientId} />
                        <input type="hidden" name="pinned" value={n.pinned ? "false" : "true"} />
                        <Button type="submit" variant="ghost" size="sm">
                          {n.pinned ? "Unpin" : "Pin"}
                        </Button>
                      </form>
                      <form action={deleteNote}>
                        <input type="hidden" name="note_id" value={n.id} />
                        <input type="hidden" name="client_id" value={clientId} />
                        <ConfirmButton confirm="Delete this note? This can't be undone." label="Delete note">
                          Delete
                        </ConfirmButton>
                      </form>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm">{n.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No notes yet" description="Keep track of session observations, preferences and anything you want to remember." />
        )}
      </div>
    </div>
  );
}
