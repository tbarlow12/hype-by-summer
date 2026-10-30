import type { Metadata } from "next";
import Link from "next/link";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clientCreditBalances } from "@/lib/clients/queries";
import { listTeam } from "@/lib/clients/team";
import { coachBreakdown, dashboardView } from "@/lib/clients/team-utils";
import { Avatar, Badge, Card, CardTitle, LinkButton, Stat, Table, cn } from "@/components/ui";
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
type Supabase = Awaited<ReturnType<typeof createClient>>;

const ACTIVE_BOOKING = ["confirmed", "completed", "no_show"] as const;
const CLOSED_LEADS = "(converted,lost,unsubscribed)";
const NO_ID = "00000000-0000-0000-0000-000000000000";
const name = (p: { full_name?: string | null; email?: string | null } | null | undefined, fallback = "A client") =>
  p ? displayName(p) : fallback;

export default async function CoachDashboard({ searchParams }: PageProps<"/coach">) {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const sp = await searchParams;
  const view = dashboardView(Array.isArray(sp.view) ? sp.view[0] : sp.view, manager);
  const mine = view === "me";
  const me = profile.id;
  const bid = business.id;
  const tz = profile.timezone;
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

  const [team, { data: rels }] = await Promise.all([
    listTeam(supabase, bid, { activeOnly: true }),
    supabase
      .from("business_clients")
      .select("client_id, status, primary_coach_id, profiles!business_clients_client_id_fkey(full_name, email)")
      .eq("business_id", bid),
  ]);
  const coachName = new Map(team.map((m) => [m.userId, m.name]));
  // "My" caseload = clients whose primary coach is me.
  const caseload = (rels ?? []).filter((r) => r.primary_coach_id === me).map((r) => r.client_id);
  const caseIds = caseload.length ? caseload : [NO_ID];

  // Query builders, narrowed to me in "my" view.
  const todayQ = supabase
    .from("bookings")
    .select("id, coach_id, starts_at, ends_at, status, location_type, location_details, video_room_url, guest_name, guest_email, client_id, session_types(name, color), profiles!bookings_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .gte("starts_at", day.start.toISOString())
    .lt("starts_at", day.end.toISOString())
    .in("status", [...ACTIVE_BOOKING, "pending_payment"])
    .order("starts_at");
  const weekQ = supabase
    .from("bookings")
    .select("coach_id")
    .eq("business_id", bid)
    .gte("starts_at", week.start.toISOString())
    .lt("starts_at", week.end.toISOString())
    .in("status", ACTIVE_BOOKING)
    .limit(5000);
  const mtdQ = supabase
    .from("payments")
    .select("status, amount_cents, amount_refunded_cents")
    .eq("business_id", bid)
    .in("status", ["succeeded", "partially_refunded", "refunded"])
    .gte("paid_at", monthStart.toISOString());
  const videosQ = supabase
    .from("video_submissions")
    .select("id, title, created_at, profiles!video_submissions_client_id_fkey(full_name, email)", { count: "exact" })
    .eq("business_id", bid)
    .eq("status", "pending_review")
    .order("created_at")
    .limit(5);
  const checkInsQ = supabase
    .from("check_ins")
    .select("id, client_id, week_of, created_at, questions, profiles!check_ins_client_id_fkey(full_name, email)", { count: "exact" })
    .eq("business_id", bid)
    .is("coach_response", null)
    .order("created_at")
    .limit(5);
  const logsQ = supabase
    .from("workout_logs")
    .select("id, client_id, performed_on, pain_flag, feedback, created_at, program_workouts(name), profiles!workout_logs_client_id_fkey(full_name, email)", { count: "exact" })
    .eq("business_id", bid)
    .is("coach_response", null)
    .or("pain_flag.eq.true,feedback.not.is.null")
    .gte("performed_on", logsSince)
    .order("pain_flag", { ascending: false })
    .order("created_at")
    .limit(5);
  const feedbackQ = supabase
    .from("program_feedback")
    .select("id, client_id, created_at, overall_rating, requested_changes, programs(name), profiles!program_feedback_client_id_fkey(full_name, email)", { count: "exact" })
    .eq("business_id", bid)
    .is("coach_response", null)
    .order("created_at")
    .limit(5);
  const followQ = supabase
    .from("leads")
    .select("id, first_name, last_name, email, next_follow_up_at, status", { count: "exact" })
    .eq("business_id", bid)
    .lte("next_follow_up_at", nowIso)
    .not("status", "in", CLOSED_LEADS)
    .order("next_follow_up_at")
    .limit(5);
  const pendingQ = supabase
    .from("bookings")
    .select("id, starts_at, hold_expires_at, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .eq("status", "pending_payment")
    .gt("hold_expires_at", nowIso)
    .order("starts_at")
    .limit(10);
  const payLaterQ = supabase
    .from("bookings")
    .select("id, starts_at, price_cents, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .eq("payment_method", "pay_later")
    .gt("price_cents", 0)
    .in("status", ["confirmed", "completed", "no_show"])
    .gte("starts_at", sixtyDaysAgo)
    .lt("starts_at", nowIso)
    .order("starts_at")
    .limit(50);
  const openLeadsQ = supabase
    .from("leads")
    .select("assigned_coach_id")
    .eq("business_id", bid)
    .not("status", "in", CLOSED_LEADS)
    .limit(5000);

  const [
    { data: today },
    { data: weekRows },
    { data: mtdPayments },
    { count: newLeads },
    { data: mrrSubs },
    { data: videos, count: videoCount },
    { data: checkIns, count: checkInCount },
    { data: flaggedLogs, count: flaggedCount },
    { data: feedback, count: feedbackCount },
    { data: followUps, count: followUpCount },
    { data: pendingBookings },
    { data: payLater },
    balances,
    { data: failingSubs },
    { data: failedPayments },
    { data: openLeads },
    { data: revenueByCoach },
  ] = await Promise.all([
    mine ? todayQ.eq("coach_id", me) : todayQ,
    mine ? weekQ.eq("coach_id", me) : weekQ,
    mine ? mtdQ.eq("coach_id", me) : manager ? mtdQ : Promise.resolve({ data: null }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", bid).gte("created_at", sevenDaysAgo),
    manager && !mine
      ? supabase.from("subscriptions").select("status, offerings(price_cents, billing_interval, interval_count)").eq("business_id", bid).in("status", MRR_STATUSES)
      : Promise.resolve({ data: null }),
    mine ? videosQ.or(`coach_id.eq.${me},and(coach_id.is.null,client_id.in.(${caseIds.join(",")}))`) : videosQ,
    mine ? checkInsQ.in("client_id", caseIds) : checkInsQ,
    mine ? logsQ.in("client_id", caseIds) : logsQ,
    mine ? feedbackQ.in("client_id", caseIds) : feedbackQ,
    mine ? followQ.eq("assigned_coach_id", me) : followQ,
    mine ? pendingQ.eq("coach_id", me) : pendingQ,
    mine ? payLaterQ.eq("coach_id", me) : payLaterQ,
    clientCreditBalances(supabase, bid),
    manager && !mine
      ? supabase
          .from("subscriptions")
          .select("id, client_id, status, offerings(name), profiles!subscriptions_client_id_fkey(full_name, email)")
          .eq("business_id", bid)
          .in("status", FAILING_SUBSCRIPTION_STATUSES)
      : Promise.resolve({ data: null }),
    manager && !mine
      ? supabase
          .from("payments")
          .select("id, client_id, created_at, amount_cents, currency, profiles!payments_client_id_fkey(full_name, email)")
          .eq("business_id", bid)
          .eq("purpose", "subscription")
          .eq("status", "failed")
          .gte("created_at", thirtyDaysAgo)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
    mine ? Promise.resolve({ data: null }) : openLeadsQ,
    manager && !mine
      ? supabase.rpc("coach_revenue_report", { p_business: bid, p_from: monthStart.toISOString(), p_to: nowIso })
      : Promise.resolve({ data: null }),
  ]);

  // Pay-later sessions without a successful payment.
  const payLaterIds = (payLater ?? []).map((b) => b.id);
  const { data: paidRows } = payLaterIds.length
    ? await supabase.from("payments").select("booking_id").eq("business_id", bid).in("booking_id", payLaterIds).in("status", ["succeeded", "partially_refunded"])
    : { data: [] as { booking_id: string | null }[] };
  const paid = new Set((paidRows ?? []).map((p) => p.booking_id));
  const unpaidLater = (payLater ?? []).filter((b) => !paid.has(b.id));

  const relBy = new Map((rels ?? []).map((r) => [r.client_id, r]));
  const inScope = (clientId: string) => !mine || relBy.get(clientId)?.primary_coach_id === me;
  const lowCredit = balances.filter(
    (b) => relBy.get(b.client_id)?.status === "active" && inScope(b.client_id) && isLowOnCredits(b.balance, b.granted),
  );
  const activeClients = (rels ?? []).filter((r) => r.status === "active" && inScope(r.client_id)).length;

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
      href: manager ? "/coach/payments" : "/coach/calendar",
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
        detail: `${f.programs?.name ?? "Program"}${f.overall_rating ? ` · ${f.overall_rating}/5` : ""}${f.requested_changes ? ` · wants: “${f.requested_changes}”` : ""}`,
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
    { label: "Unpaid sessions", href: manager ? "/coach/payments" : "/coach/calendar", total: unpaidItems.length, items: unpaidItems.slice(0, 5) },
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

  const activity = await recentActivity(supabase, { bid, me, mine, manager, caseIds, now, tz });
  const mrr = monthlyRecurringCents(
    (mrrSubs ?? []).map((s) => ({
      status: s.status,
      price_cents: s.offerings?.price_cents ?? null,
      billing_interval: s.offerings?.billing_interval ?? null,
      interval_count: s.offerings?.interval_count ?? null,
    })),
  );
  const firstName = profile.full_name?.split(/\s+/)[0];
  const remainingToday = (today ?? []).filter((b) => b.ends_at > nowIso && b.status !== "no_show").length;
  const breakdown = mine
    ? []
    : coachBreakdown({
        coachIds: team.filter((m) => m.isBookable || m.role === "coach").map((m) => m.userId),
        today: today ?? [],
        week: weekRows ?? [],
        clients: rels ?? [],
        leads: openLeads ?? [],
        revenue: manager ? (revenueByCoach ?? []).map((r) => ({ coach_id: r.coach_id, net_cents: Number(r.net_cents ?? 0) })) : null,
      });
  const unassignedRevenue = manager && !mine ? Number((revenueByCoach ?? []).find((r) => !r.coach_id)?.net_cents ?? 0) : 0;
  const teamSize = team.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting(tz, now)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatDate(now, tz, "EEEE, MMMM d")} ·{" "}
            {remainingToday
              ? `${remainingToday} session${remainingToday === 1 ? "" : "s"} left today${mine ? "" : " across the team"}`
              : "No more sessions today"}
            {inboxTotal ? ` · ${inboxTotal} item${inboxTotal === 1 ? "" : "s"} need ${mine ? "you" : "the team"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teamSize > 1 || manager ? (
            <div role="tablist" aria-label="Dashboard scope" className="flex rounded-full border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
              {(["me", "team"] as const).map((v) => (
                <Link
                  key={v}
                  href={`/coach?view=${v}`}
                  role="tab"
                  aria-selected={view === v}
                  className={cn(
                    "rounded-full px-3 py-1 font-medium",
                    view === v ? "bg-brand text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {v === "me" ? "My day" : manager ? "Business" : "Team"}
                </Link>
              ))}
            </div>
          ) : null}
          <LinkButton href="/coach/calendar" size="sm" variant="outline">
            Calendar
          </LinkButton>
          <LinkButton href="/coach/clients" size="sm">
            Clients
          </LinkButton>
        </div>
      </div>

      {mine ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="My sessions this week" value={weekRows?.length ?? 0} hint={`Week of ${formatDate(`${week.monday}T12:00:00Z`, "UTC", "MMM d")}`} />
          <Stat label="My clients" value={activeClients} hint="Active, you're their primary coach" />
          <Stat label="My revenue MTD" value={formatMoney(netPaidCents(mtdPayments ?? []))} hint={formatDate(now, tz, "MMMM")} />
          <Stat label="My follow-ups due" value={followUpCount ?? 0} hint={<Link href="/coach/leads" className="text-brand hover:underline">View leads</Link>} />
        </div>
      ) : manager ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Revenue MTD" value={formatMoney(netPaidCents(mtdPayments ?? []))} hint={formatDate(now, tz, "MMMM")} />
          <Stat label="MRR" value={formatMoney(mrr)} hint={`${mrrSubs?.length ?? 0} subscription${mrrSubs?.length === 1 ? "" : "s"}`} />
          <Stat label="Active clients" value={activeClients} />
          <Stat label="New leads (7d)" value={newLeads ?? 0} hint={<Link href="/coach/leads" className="text-brand hover:underline">View leads</Link>} />
          <Stat label="Sessions this week" value={weekRows?.length ?? 0} hint={`Week of ${formatDate(`${week.monday}T12:00:00Z`, "UTC", "MMM d")}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Team sessions this week" value={weekRows?.length ?? 0} hint={`Week of ${formatDate(`${week.monday}T12:00:00Z`, "UTC", "MMM d")}`} />
          <Stat label="Active clients" value={activeClients} />
          <Stat label="New leads (7d)" value={newLeads ?? 0} />
        </div>
      )}

      {!mine && breakdown.length ? (
        <Card className="p-0">
          <div className="flex items-center justify-between px-5 pt-5">
            <CardTitle>By coach</CardTitle>
            {manager ? (
              <Link href="/coach/team" className="text-sm text-brand hover:underline">
                Manage team
              </Link>
            ) : null}
          </div>
          <div className="mt-3 [&>div]:rounded-none [&>div]:border-x-0 [&>div]:border-b-0">
            <Table>
              <thead>
                <tr>
                  <th>Coach</th>
                  <th className="text-right">Today</th>
                  <th className="text-right">This week</th>
                  <th className="text-right">Active clients</th>
                  <th className="text-right">Open leads</th>
                  {manager ? <th className="text-right">Revenue MTD</th> : null}
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => {
                  const m = team.find((t) => t.userId === r.coachId);
                  return (
                    <tr key={r.coachId}>
                      <td>
                        <span className="flex items-center gap-2">
                          <Avatar name={m?.name} src={m?.avatarUrl} size={28} />
                          <span className="font-medium">{m?.name ?? "Coach"}</span>
                          {r.coachId === me ? <Badge>You</Badge> : null}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{r.sessionsToday}</td>
                      <td className="text-right tabular-nums">{r.sessionsWeek}</td>
                      <td className="text-right tabular-nums">{r.activeClients}</td>
                      <td className="text-right tabular-nums">{r.openLeads}</td>
                      {manager ? <td className="text-right tabular-nums">{formatMoney(r.revenueCents ?? 0)}</td> : null}
                    </tr>
                  );
                })}
                {manager && unassignedRevenue > 0 ? (
                  <tr>
                    <td className="text-zinc-500">Not attributed to a coach</td>
                    <td colSpan={4} />
                    <td className="text-right tabular-nums">{formatMoney(unassignedRevenue)}</td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="h-fit">
          <div className="flex items-center justify-between">
            <CardTitle>{mine ? "My day" : "Today"}</CardTitle>
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
                    style={{ borderLeftColor: b.session_types?.color ?? "var(--brand)" }}
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
                        {!mine ? ` · ${b.coach_id === me ? "You" : (coachName.get(b.coach_id) ?? "Coach")}` : ""}
                      </p>
                    </div>
                    {b.status === "pending_payment" ? <Badge tone="amber">Unpaid</Badge> : null}
                    {b.status === "no_show" ? <Badge tone="red">No-show</Badge> : null}
                    {live ? <Badge tone="brand">Now</Badge> : null}
                    {b.location_type === "virtual" && b.video_room_url && !past && b.coach_id === me ? (
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
            <CardTitle>{mine ? "Needs your attention" : "Needs attention"}</CardTitle>
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
          {mine && !caseload.length ? (
            <p className="mt-3 text-xs text-zinc-500">
              No clients list you as their primary coach yet, so reviews for the whole team show under{" "}
              <Link href="/coach?view=team" className="text-brand hover:underline">
                {manager ? "Business" : "Team"}
              </Link>
              .
            </p>
          ) : null}
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
  supabase: Supabase,
  o: { bid: string; me: string; mine: boolean; manager: boolean; caseIds: string[]; now: Date; tz: string },
): Promise<Activity[]> {
  const { bid, me, mine, manager, caseIds, now, tz } = o;
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const bookingsQ = supabase
    .from("bookings")
    .select("id, created_at, starts_at, status, client_id, guest_name, guest_email, session_types(name), profiles!bookings_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .gte("created_at", since)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(8);
  const paymentsQ = supabase
    .from("payments")
    .select("id, paid_at, amount_cents, currency, description, purpose, client_id, payer_email, profiles!payments_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .eq("status", "succeeded")
    .gte("paid_at", since)
    .order("paid_at", { ascending: false })
    .limit(8);
  const logsQ = supabase
    .from("workout_logs")
    .select("id, created_at, client_id, program_workouts(name), profiles!workout_logs_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  const checkInsQ = supabase
    .from("check_ins")
    .select("id, created_at, client_id, profiles!check_ins_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  const leadsQ = supabase
    .from("leads")
    .select("id, created_at, first_name, last_name, email, source")
    .eq("business_id", bid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  const videosQ = supabase
    .from("video_submissions")
    .select("id, created_at, title, profiles!video_submissions_client_id_fkey(full_name, email)")
    .eq("business_id", bid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);

  const [{ data: bookings }, { data: payments }, { data: logs }, { data: checkIns }, { data: leads }, { data: videos }] = await Promise.all([
    mine ? bookingsQ.eq("coach_id", me) : bookingsQ,
    mine ? paymentsQ.eq("coach_id", me) : manager ? paymentsQ : Promise.resolve({ data: null }),
    mine ? logsQ.in("client_id", caseIds) : logsQ,
    mine ? checkInsQ.in("client_id", caseIds) : checkInsQ,
    mine ? leadsQ.eq("assigned_coach_id", me) : leadsQ,
    mine ? videosQ.or(`coach_id.eq.${me},and(coach_id.is.null,client_id.in.(${caseIds.join(",")}))`) : videosQ,
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
      href: p.client_id ? `/coach/clients/${p.client_id}` : manager ? "/coach/payments" : "/coach/clients",
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
