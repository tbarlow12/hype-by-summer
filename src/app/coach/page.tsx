import type { Metadata } from "next";
import Link from "next/link";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { trainerCreditBalances } from "@/lib/clients/queries";
import { Badge, Card, CardTitle, LinkButton, Stat, cn } from "@/components/ui";
import { displayName, formatDate, formatMoney, formatTime, titleCase } from "@/lib/format";
import {
  FAILING_SUBSCRIPTION_STATUSES,
  MRR_STATUSES,
  addDaysToDateString,
  greeting,
  isLowOnCredits,
  localDateString,
  monthlyRecurringCents,
  netPaidCents,
  timeAgo,
  zonedDayRange,
  zonedMonthStart,
  zonedWeekRange,
} from "@/lib/clients/metrics";

export const metadata: Metadata = { title: "Dashboard" };

type InboxItem = { key: string; title: string; detail?: string; href: string; at: string; urgent?: boolean };
type InboxGroup = { label: string; items: InboxItem[]; total: number; href: string };
type Activity = { key: string; at: string; text: string; href: string };

const ACTIVE_BOOKING = ["confirmed", "completed", "no_show"] as const;
const name = (p: { full_name?: string | null; email?: string | null } | null | undefined, fallback = "A client") =>
  p ? displayName(p) : fallback;

export default async function CoachDashboard() {
  const trainer = await requireTrainer();
  const tz = trainer.timezone;
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const day = zonedDayRange(tz, now);
  const week = zonedWeekRange(tz, now);
  const monthStart = zonedMonthStart(tz, now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const logsSince = addDaysToDateString(localDateString(tz, now), -30);
  const tid = trainer.id;

  const [
    { data: today },
    { count: weekSessions },
    { data: mtdPayments },
    { count: activeClients },
    { count: newLeads },
    { data: mrrSubs },
    { data: videos, count: videoCount },
    { data: checkIns, count: checkInCount },
    { data: flaggedLogs, count: flaggedCount },
    { data: feedback, count: feedbackCount },
    { data: followUps, count: followUpCount },
    { data: pendingBookings },
    { data: payLater },
    { data: balances },
    { data: rels },
    { data: failingSubs },
    { data: failedPayments },
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, hold_expires_at, location_type, location_details, video_room_url, guest_name, guest_email, client_id, session_types(name, color), profiles!bookings_client_id_fkey(full_name, email, avatar_url)")
      .eq("trainer_id", tid)
      .gte("starts_at", day.start.toISOString())
      .lt("starts_at", day.end.toISOString())
      .in("status", [...ACTIVE_BOOKING, "pending_payment"])
      .order("starts_at"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("trainer_id", tid)
      .gte("starts_at", week.start.toISOString())
      .lt("starts_at", week.end.toISOString())
      .in("status", ACTIVE_BOOKING),
    supabase
      .from("payments")
      .select("status, amount_cents, amount_refunded_cents")
      .eq("trainer_id", tid)
      .in("status", ["succeeded", "partially_refunded", "refunded"])
      .gte("paid_at", monthStart.toISOString()),
    supabase.from("trainer_clients").select("client_id", { count: "exact", head: true }).eq("trainer_id", tid).eq("status", "active"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("trainer_id", tid).gte("created_at", sevenDaysAgo),
    supabase.from("subscriptions").select("status, offerings(price_cents, billing_interval, interval_count)").eq("trainer_id", tid).in("status", MRR_STATUSES),
    supabase
      .from("video_submissions")
      .select("id, title, created_at, profiles!video_submissions_client_id_fkey(full_name, email)", { count: "exact" })
      .eq("trainer_id", tid)
      .eq("status", "pending_review")
      .order("created_at")
      .limit(5),
    supabase
      .from("check_ins")
      .select("id, client_id, week_of, created_at, questions, profiles!check_ins_client_id_fkey(full_name, email)", { count: "exact" })
      .eq("trainer_id", tid)
      .is("trainer_response", null)
      .order("created_at")
      .limit(5),
    supabase
      .from("workout_logs")
      .select("id, client_id, performed_on, pain_flag, feedback, created_at, program_workouts(name), profiles!workout_logs_client_id_fkey(full_name, email)", { count: "exact" })
      .is("trainer_response", null)
      .or("pain_flag.eq.true,feedback.not.is.null")
      .gte("performed_on", logsSince)
      .order("pain_flag", { ascending: false })
      .order("created_at")
      .limit(5),
    supabase
      .from("program_feedback")
      .select("id, client_id, created_at, overall_rating, requested_changes, programs!inner(name, trainer_id), profiles(full_name, email)", { count: "exact" })
      .eq("programs.trainer_id", tid)
      .is("trainer_response", null)
      .order("created_at")
      .limit(5),
    supabase
      .from("leads")
      .select("id, first_name, last_name, email, next_follow_up_at, status", { count: "exact" })
      .eq("trainer_id", tid)
      .lte("next_follow_up_at", nowIso)
      .not("status", "in", "(converted,lost,unsubscribed)")
      .order("next_follow_up_at")
      .limit(5),
    supabase
      .from("bookings")
      .select("id, starts_at, hold_expires_at, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .eq("status", "pending_payment")
      .gt("hold_expires_at", nowIso)
      .order("starts_at")
      .limit(10),
    supabase
      .from("bookings")
      .select("id, starts_at, price_cents, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .eq("payment_method", "pay_later")
      .gt("price_cents", 0)
      .in("status", ["confirmed", "completed", "no_show"])
      .gte("starts_at", sixtyDaysAgo)
      .lt("starts_at", nowIso)
      .order("starts_at")
      .limit(50),
    trainerCreditBalances(supabase, tid).then((data) => ({ data })),
    supabase.from("trainer_clients").select("client_id, status, profiles!trainer_clients_client_id_fkey(full_name, email)").eq("trainer_id", tid),
    supabase
      .from("subscriptions")
      .select("id, client_id, status, offerings(name), profiles!subscriptions_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .in("status", FAILING_SUBSCRIPTION_STATUSES),
    supabase
      .from("payments")
      .select("id, client_id, created_at, amount_cents, currency, profiles!payments_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .eq("purpose", "subscription")
      .eq("status", "failed")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Pay-later sessions without a successful payment.
  const payLaterIds = (payLater ?? []).map((b) => b.id);
  const { data: paidRows } = payLaterIds.length
    ? await supabase.from("payments").select("booking_id").in("booking_id", payLaterIds).in("status", ["succeeded", "partially_refunded"])
    : { data: [] as { booking_id: string | null }[] };
  const paid = new Set((paidRows ?? []).map((p) => p.booking_id));
  const unpaidLater = (payLater ?? []).filter((b) => !paid.has(b.id));

  const relBy = new Map((rels ?? []).map((r) => [r.client_id, r]));
  const lowCredit = (balances ?? []).filter(
    (b) => relBy.get(b.client_id)?.status === "active" && isLowOnCredits(b.balance, b.granted),
  );

  // Failed subscription payments: one entry per client.
  const billingIssues = new Map<string, InboxItem>();
  for (const s of failingSubs ?? []) {
    billingIssues.set(s.client_id, {
      key: `sub-${s.id}`,
      title: name(s.profiles),
      detail: `${s.offerings?.name ?? "Membership"} is ${titleCase(s.status).toLowerCase()}`,
      href: `/coach/clients/${s.client_id}`,
      at: nowIso,
      urgent: true,
    });
  }
  for (const p of failedPayments ?? []) {
    if (!p.client_id || billingIssues.has(p.client_id)) continue;
    billingIssues.set(p.client_id, {
      key: `pay-${p.id}`,
      title: name(p.profiles),
      detail: `${formatMoney(p.amount_cents, p.currency)} subscription payment failed ${timeAgo(p.created_at, now, tz)}`,
      href: `/coach/clients/${p.client_id}`,
      at: p.created_at,
      urgent: true,
    });
  }

  const unpaidItems: InboxItem[] = [
    ...(pendingBookings ?? []).map((b) => ({
      key: `pend-${b.id}`,
      title: b.profiles ? name(b.profiles) : (b.guest_name ?? b.guest_email ?? "Guest"),
      detail: `${b.session_types?.name ?? "Session"} ${formatDate(b.starts_at, tz, "EEE MMM d, h:mm a")} · awaiting checkout`,
      href: "/coach/calendar",
      at: b.starts_at,
    })),
    ...unpaidLater.map((b) => ({
      key: `later-${b.id}`,
      title: b.profiles ? name(b.profiles) : (b.guest_name ?? b.guest_email ?? "Guest"),
      detail: `${b.session_types?.name ?? "Session"} on ${formatDate(b.starts_at, tz, "MMM d")} · ${formatMoney(b.price_cents)} unpaid`,
      href: "/coach/payments",
      at: b.starts_at,
      urgent: true,
    })),
  ];

  const groups: InboxGroup[] = [
    {
      label: "Workout logs to review",
      href: "/coach/clients",
      total: flaggedCount ?? 0,
      items: (flaggedLogs ?? []).map((l) => ({
        key: `log-${l.id}`,
        title: name(l.profiles),
        detail: `${l.pain_flag ? "Reported pain · " : ""}${l.program_workouts?.name ?? "Workout"}${l.feedback ? `: “${l.feedback}”` : ""}`,
        href: `/coach/clients/${l.client_id}?tab=training`,
        at: l.created_at,
        urgent: l.pain_flag,
      })),
    },
    {
      label: "Form checks to review",
      href: "/coach/videos",
      total: videoCount ?? 0,
      items: (videos ?? []).map((v) => ({
        key: `vid-${v.id}`,
        title: name(v.profiles),
        detail: v.title,
        href: `/coach/videos/${v.id}`,
        at: v.created_at,
      })),
    },
    {
      label: "Check-ins awaiting response",
      href: "/coach/check-ins",
      total: checkInCount ?? 0,
      items: (checkIns ?? []).map((c) => ({
        key: `ci-${c.id}`,
        title: name(c.profiles),
        detail: c.questions ? `Asks: “${c.questions}”` : `Week of ${formatDate(`${c.week_of}T12:00:00Z`, "UTC", "MMM d")}`,
        href: `/coach/check-ins/${c.id}`,
        at: c.created_at,
      })),
    },
    {
      label: "Program feedback",
      href: "/coach/programs",
      total: feedbackCount ?? 0,
      items: (feedback ?? []).map((f) => ({
        key: `fb-${f.id}`,
        title: name(f.profiles),
        detail: `${f.programs.name}${f.overall_rating ? ` · ${f.overall_rating}/5` : ""}${f.requested_changes ? ` · wants: “${f.requested_changes}”` : ""}`,
        href: `/coach/clients/${f.client_id}?tab=training`,
        at: f.created_at,
      })),
    },
    {
      label: "Lead follow-ups due",
      href: "/coach/leads",
      total: followUpCount ?? 0,
      items: (followUps ?? []).map((l) => ({
        key: `lead-${l.id}`,
        title: [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email,
        detail: `${titleCase(l.status)} · due ${timeAgo(l.next_follow_up_at!, now, tz)}`,
        href: `/coach/leads/${l.id}`,
        at: l.next_follow_up_at!,
      })),
    },
    { label: "Unpaid sessions", href: "/coach/payments", total: unpaidItems.length, items: unpaidItems.slice(0, 5) },
    {
      label: "Billing problems",
      href: "/coach/payments",
      total: billingIssues.size,
      items: [...billingIssues.values()].slice(0, 5),
    },
    {
      label: "Low on credits",
      href: "/coach/clients",
      total: lowCredit.length,
      items: lowCredit.slice(0, 5).map((b) => ({
        key: `cred-${b.client_id}`,
        title: name(relBy.get(b.client_id)?.profiles),
        detail: b.balance === 0 ? "Out of credits" : "1 credit left",
        href: `/coach/clients/${b.client_id}`,
        at: nowIso,
      })),
    },
  ].filter((g) => g.total > 0);
  const inboxTotal = groups.reduce((s, g) => s + g.total, 0);

  const activity = await recentActivity(supabase, tid, now, tz);
  const mrr = monthlyRecurringCents(
    (mrrSubs ?? []).map((s) => ({
      status: s.status,
      price_cents: s.offerings?.price_cents ?? null,
      billing_interval: s.offerings?.billing_interval ?? null,
      interval_count: s.offerings?.interval_count ?? null,
    })),
  );
  const firstName = trainer.full_name?.split(/\s+/)[0];
  const remainingToday = (today ?? []).filter((b) => b.ends_at > nowIso && b.status !== "no_show").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting(tz, now)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatDate(now, tz, "EEEE, MMMM d")} · {remainingToday ? `${remainingToday} session${remainingToday === 1 ? "" : "s"} left today` : "No more sessions today"}
            {inboxTotal ? ` · ${inboxTotal} item${inboxTotal === 1 ? "" : "s"} need you` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/coach/calendar" size="sm" variant="outline">
            Calendar
          </LinkButton>
          <LinkButton href="/coach/clients" size="sm">
            Clients
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Sessions this week" value={weekSessions ?? 0} hint={`Week of ${formatDate(`${week.monday}T12:00:00Z`, "UTC", "MMM d")}`} />
        <Stat label="Revenue MTD" value={formatMoney(netPaidCents(mtdPayments ?? []))} hint={formatDate(now, tz, "MMMM")} />
        <Stat label="MRR" value={formatMoney(mrr)} hint={`${mrrSubs?.length ?? 0} subscription${mrrSubs?.length === 1 ? "" : "s"}`} />
        <Stat label="Active clients" value={activeClients ?? 0} />
        <Stat label="New leads (7d)" value={newLeads ?? 0} hint={<Link href="/coach/leads" className="text-brand hover:underline">View leads</Link>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="h-fit">
          <div className="flex items-center justify-between">
            <CardTitle>Today</CardTitle>
            <Link href="/coach/calendar" className="text-sm text-brand hover:underline">
              Full calendar
            </Link>
          </div>
          {today?.length ? (
            <ol className="mt-3 space-y-2">
              {today.map((b) => {
                const past = b.ends_at <= nowIso;
                const live = b.starts_at <= nowIso && !past;
                const who = b.profiles ? name(b.profiles) : (b.guest_name ?? b.guest_email ?? "Guest");
                return (
                  <li
                    key={b.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border-l-4 bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50",
                      past && "opacity-60",
                    )}
                    style={{ borderLeftColor: b.session_types?.color ?? "#e11d48" }}
                  >
                    <div className="w-16 shrink-0 text-sm font-semibold tabular-nums">{formatTime(b.starts_at, tz)}</div>
                    <div className="min-w-0 flex-1">
                      {b.client_id ? (
                        <Link href={`/coach/clients/${b.client_id}`} className="block truncate font-medium hover:text-brand">
                          {who}
                        </Link>
                      ) : (
                        <p className="truncate font-medium">{who}</p>
                      )}
                      <p className="truncate text-xs text-zinc-500">
                        {b.session_types?.name ?? "Session"} · {b.location_type === "virtual" ? "Virtual" : (b.location_details ?? titleCase(b.location_type))}
                      </p>
                    </div>
                    {b.status === "pending_payment" ? <Badge tone="amber">Unpaid</Badge> : null}
                    {b.status === "no_show" ? <Badge tone="red">No-show</Badge> : null}
                    {live ? <Badge tone="brand">Now</Badge> : null}
                    {b.location_type === "virtual" && b.video_room_url && !past ? (
                      <a
                        href={b.video_room_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand hover:bg-brand-dark"
                      >
                        Join
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Nothing on the calendar today.</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Needs your attention</CardTitle>
            {inboxTotal ? <Badge tone="brand">{inboxTotal}</Badge> : null}
          </div>
          {groups.length ? (
            <div className="mt-3 space-y-5">
              {groups.map((g) => (
                <section key={g.label}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {g.label} <span className="text-zinc-400">({g.total})</span>
                    </h3>
                    {g.total > g.items.length ? (
                      <Link href={g.href} className="text-xs text-brand hover:underline">
                        See all
                      </Link>
                    ) : null}
                  </div>
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {g.items.map((i) => (
                      <li key={i.key}>
                        <Link href={i.href} className="flex items-start gap-2 py-2 hover:text-brand">
                          {i.urgent ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500" aria-label="Urgent" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden />}
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{i.title}</span>
                            {i.detail ? <span className="block truncate text-xs text-zinc-500">{i.detail}</span> : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              All caught up. No reviews, follow-ups or billing issues waiting.
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Recent activity</CardTitle>
        {activity.length ? (
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {activity.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={a.href} className="min-w-0 truncate hover:text-brand">
                  {a.text}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">{timeAgo(a.at, now, tz)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No activity yet. Share your booking page to get started.</p>
        )}
      </Card>
    </div>
  );
}

async function recentActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tid: string,
  now: Date,
  tz: string,
): Promise<Activity[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [{ data: bookings }, { data: payments }, { data: logs }, { data: checkIns }, { data: leads }, { data: videos }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, created_at, starts_at, status, client_id, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .gte("created_at", since)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("payments")
      .select("id, paid_at, amount_cents, currency, description, purpose, client_id, payer_email, profiles!payments_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .eq("status", "succeeded")
      .gte("paid_at", since)
      .order("paid_at", { ascending: false })
      .limit(8),
    supabase
      .from("workout_logs")
      .select("id, created_at, client_id, program_workouts(name), profiles!workout_logs_client_id_fkey(full_name, email)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("check_ins")
      .select("id, created_at, client_id, profiles!check_ins_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("leads")
      .select("id, created_at, first_name, last_name, email, source")
      .eq("trainer_id", tid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("video_submissions")
      .select("id, created_at, title, profiles!video_submissions_client_id_fkey(full_name, email)")
      .eq("trainer_id", tid)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const items: Activity[] = [
    ...(bookings ?? []).map((b) => ({
      key: `b-${b.id}`,
      at: b.created_at,
      text: `${b.profiles ? name(b.profiles) : (b.guest_name ?? b.guest_email ?? "A guest")} ${b.status === "cancelled" || b.status === "late_cancelled" ? "booked (now cancelled)" : "booked"} ${b.session_types?.name ?? "a session"} for ${formatDate(b.starts_at, tz, "EEE MMM d, h:mm a")}`,
      href: b.client_id ? `/coach/clients/${b.client_id}` : "/coach/calendar",
    })),
    ...(payments ?? []).map((p) => ({
      key: `p-${p.id}`,
      at: p.paid_at!,
      text: `${p.profiles ? name(p.profiles) : (p.payer_email ?? "Someone")} paid ${formatMoney(p.amount_cents, p.currency)}${p.description ? ` · ${p.description}` : ` · ${titleCase(p.purpose)}`}`,
      href: p.client_id ? `/coach/clients/${p.client_id}` : "/coach/payments",
    })),
    ...(logs ?? []).map((l) => ({
      key: `l-${l.id}`,
      at: l.created_at,
      text: `${name(l.profiles)} logged ${l.program_workouts?.name ?? "a workout"}`,
      href: `/coach/clients/${l.client_id}?tab=training`,
    })),
    ...(checkIns ?? []).map((c) => ({
      key: `c-${c.id}`,
      at: c.created_at,
      text: `${name(c.profiles)} submitted a weekly check-in`,
      href: `/coach/check-ins/${c.id}`,
    })),
    ...(leads ?? []).map((l) => ({
      key: `ld-${l.id}`,
      at: l.created_at,
      text: `New lead: ${[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email}${l.source ? ` via ${titleCase(l.source).toLowerCase()}` : ""}`,
      href: `/coach/leads/${l.id}`,
    })),
    ...(videos ?? []).map((v) => ({
      key: `v-${v.id}`,
      at: v.created_at,
      text: `${name(v.profiles)} uploaded a form check: ${v.title}`,
      href: `/coach/videos/${v.id}`,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 15);
}
