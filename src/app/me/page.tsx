import type { Metadata } from "next";
import Link from "next/link";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardTitle, EmptyState, LinkButton, cn } from "@/components/ui";
import { InstallHint } from "@/components/clients/install-hint";
import { BRAND_NAME } from "@/lib/env";
import { displayName, formatDate, formatDateTime, formatDuration, titleCase } from "@/lib/format";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  greeting,
  localDateString,
  programPosition,
  zonedWeekRange,
} from "@/lib/clients/metrics";
import { onboardingSteps } from "@/lib/clients/onboarding";

export const metadata: Metadata = { title: "Home" };

const UPCOMING_STATUSES = ["confirmed", "pending_payment"] as const;

export default async function ClientHome() {
  const profile = await requireClient();
  const tz = profile.timezone;
  const trainerId = await getClientTrainerId(profile.id);
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = localDateString(tz, now);
  const week = zonedWeekRange(tz, now);

  const [
    { data: nextBookings },
    { count: bookingCount },
    { data: intake },
    { data: program },
    { data: weekCheckIn },
    { data: convo },
    { data: credits },
    { data: subs },
    { data: habits },
    { data: coach },
    { data: logResponses },
    { data: checkInResponses },
    { data: videoReviews },
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, hold_expires_at, location_type, location_details, video_room_url, session_types(name, duration_minutes)")
      .eq("client_id", profile.id)
      .in("status", UPCOMING_STATUSES)
      .gte("ends_at", nowIso)
      .order("starts_at")
      .limit(5),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("client_id", profile.id).neq("status", "cancelled"),
    trainerId
      ? supabase.from("client_intakes").select("*").eq("client_id", profile.id).eq("trainer_id", trainerId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("programs")
      .select("id, name, start_date, duration_weeks, program_workouts(id, week, day, name, estimated_minutes, sort_order)")
      .eq("client_id", profile.id)
      .eq("status", "active")
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("check_ins").select("id, created_at").eq("client_id", profile.id).gte("created_at", week.start.toISOString()).limit(1).maybeSingle(),
    supabase
      .from("conversations")
      .select("id, last_message_at, client_last_read_at")
      .eq("client_id", profile.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    trainerId ? supabase.rpc("credit_balance", { p_client: profile.id, p_trainer: trainerId }) : Promise.resolve({ data: 0 }),
    supabase
      .from("subscriptions")
      .select("id, status, current_period_end, cancel_at_period_end, trial_end, offerings(name)")
      .eq("client_id", profile.id)
      .in("status", LIVE_SUBSCRIPTION_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("habits").select("id, name, target_per_week, habit_logs(logged_on)").eq("client_id", profile.id).eq("active", true).gte("habit_logs.logged_on", week.monday).order("created_at"),
    trainerId ? supabase.from("profiles").select("full_name, email, avatar_url").eq("id", trainerId).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("workout_logs")
      .select("id, performed_on, trainer_response, trainer_responded_at, program_workouts(name)")
      .eq("client_id", profile.id)
      .not("trainer_response", "is", null)
      .order("trainer_responded_at", { ascending: false })
      .limit(3),
    supabase
      .from("check_ins")
      .select("id, week_of, trainer_response, trainer_responded_at")
      .eq("client_id", profile.id)
      .not("trainer_response", "is", null)
      .order("trainer_responded_at", { ascending: false })
      .limit(3),
    supabase
      .from("video_submissions")
      .select("id, title, reviewed_at")
      .eq("client_id", profile.id)
      .eq("status", "reviewed")
      .order("reviewed_at", { ascending: false })
      .limit(3),
  ]);

  // Unread messages (from the coach since I last read the thread).
  let unread = 0;
  let lastMessage: { body: string | null; kind: string; created_at: string } | null = null;
  if (convo) {
    let q = supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convo.id)
      .neq("sender_id", profile.id)
      .is("deleted_at", null);
    if (convo.client_last_read_at) q = q.gt("created_at", convo.client_last_read_at);
    const [{ count }, { data: last }] = await Promise.all([
      q,
      supabase
        .from("messages")
        .select("body, kind, created_at")
        .eq("conversation_id", convo.id)
        .neq("sender_id", profile.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    unread = count ?? 0;
    lastMessage = last;
  }

  // Today's workout from the active program.
  const workouts = [...(program?.program_workouts ?? [])].sort(
    (a, b) => a.week - b.week || a.day - b.day || a.sort_order - b.sort_order,
  );
  const pos = program?.start_date ? programPosition(program.start_date, today, program.duration_weeks) : null;
  const todays = pos ? workouts.filter((w) => w.week === pos.week && w.day === pos.day) : [];
  const upcomingWorkout = pos
    ? workouts.find((w) => w.week > pos.week || (w.week === pos.week && w.day > pos.day))
    : program?.start_date && program.start_date > today
      ? workouts[0]
      : undefined;
  const { data: todaysLogs } = todays.length
    ? await supabase.from("workout_logs").select("workout_id").eq("client_id", profile.id).eq("performed_on", today).in("workout_id", todays.map((w) => w.id))
    : { data: [] as { workout_id: string | null }[] };
  const doneToday = new Set((todaysLogs ?? []).map((l) => l.workout_id));

  const next = (nextBookings ?? []).find(
    (b) => b.status === "confirmed" || (b.hold_expires_at && b.hold_expires_at > nowIso),
  );
  const steps = onboardingSteps({ profile, intake, hasBooking: (bookingCount ?? 0) > 0 });
  const remaining = steps.filter((s) => !s.done).length;
  const sub = subs?.[0];
  const firstName = profile.full_name?.split(/\s+/)[0];
  const coachName = coach ? displayName(coach) : "your coach";

  const responses = [
    ...(logResponses ?? []).map((l) => ({
      key: `log-${l.id}`,
      at: l.trainer_responded_at ?? l.performed_on,
      title: `On your ${l.program_workouts?.name ?? "workout"} (${formatDate(`${l.performed_on}T12:00:00Z`, "UTC", "MMM d")})`,
      body: l.trainer_response,
      href: "/me/plan",
    })),
    ...(checkInResponses ?? []).map((c) => ({
      key: `ci-${c.id}`,
      at: c.trainer_responded_at ?? c.week_of,
      title: `Check-in for week of ${formatDate(`${c.week_of}T12:00:00Z`, "UTC", "MMM d")}`,
      body: c.trainer_response,
      href: "/me/check-in",
    })),
    ...(videoReviews ?? []).map((v) => ({
      key: `vid-${v.id}`,
      at: v.reviewed_at ?? "",
      title: `Form check reviewed: ${v.title}`,
      body: null as string | null,
      href: "/me/videos",
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting(tz, now)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{formatDate(now, tz, "EEEE, MMMM d")}</p>
      </div>

      {remaining > 0 ? (
        <Card className="border-brand/30">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Let&apos;s get you set up</CardTitle>
            <span className="text-sm text-zinc-500">
              {steps.length - remaining} of {steps.length} done
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${((steps.length - remaining) / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-4 space-y-2">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className={cn(
                    "flex items-start gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                    s.done && "opacity-60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                      s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600",
                    )}
                  >
                    {s.done ? "✓" : ""}
                  </span>
                  <span>
                    <span className={cn("block text-sm font-medium", s.done && "line-through")}>{s.title}</span>
                    <span className="block text-xs text-zinc-500">{s.description}</span>
                  </span>
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <InstallHint appName={BRAND_NAME} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Next session</CardTitle>
            <Link href="/me/bookings" className="text-sm text-brand hover:underline">
              All sessions
            </Link>
          </div>
          {next ? (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-lg font-semibold">{formatDateTime(next.starts_at, tz)}</p>
                <p className="text-sm text-zinc-500">
                  {next.session_types?.name ?? "Session"}
                  {next.session_types?.duration_minutes ? ` · ${formatDuration(next.session_types.duration_minutes)}` : ""} ·{" "}
                  {titleCase(next.location_type)}
                </p>
                {next.location_type !== "virtual" && next.location_details ? (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{next.location_details}</p>
                ) : null}
              </div>
              {next.status === "pending_payment" ? (
                <Badge tone="amber">Payment pending: complete checkout to confirm</Badge>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {next.location_type === "virtual" && next.video_room_url ? (
                  <a href={next.video_room_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">
                    Join video call
                  </a>
                ) : null}
                <LinkButton href="/me/bookings" variant="outline">
                  Details
                </LinkButton>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-zinc-500">Nothing booked yet.</p>
              <LinkButton href="/me/book" className="mt-3">
                Book a session
              </LinkButton>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Today&apos;s workout</CardTitle>
            <Link href="/me/plan" className="text-sm text-brand hover:underline">
              My plan
            </Link>
          </div>
          {!program ? (
            <p className="mt-3 text-sm text-zinc-500">{`No program yet. ${coachName} will assign one soon.`}</p>
          ) : todays.length ? (
            <ul className="mt-3 space-y-2">
              {todays.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                  <div>
                    <p className="font-medium">{w.name}</p>
                    <p className="text-xs text-zinc-500">
                      {program.name} · Week {w.week}, day {w.day}
                      {w.estimated_minutes ? ` · ~${w.estimated_minutes} min` : ""}
                    </p>
                  </div>
                  {doneToday.has(w.id) ? (
                    <Badge tone="green">Logged</Badge>
                  ) : (
                    <LinkButton href={`/me/plan/workouts/${w.id}`} size="sm">
                      Start
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 text-sm">
              <p className="text-zinc-500">
                {pos ? "Rest day. Recover well!" : program.start_date && program.start_date > today ? `${program.name} starts ${formatDate(`${program.start_date}T12:00:00Z`, "UTC", "EEE, MMM d")}.` : `${program.name} is complete. Nice work!`}
              </p>
              {upcomingWorkout ? (
                <p className="mt-2">
                  Next up:{" "}
                  <Link href={`/me/plan/workouts/${upcomingWorkout.id}`} className="font-medium text-brand hover:underline">
                    {upcomingWorkout.name}
                  </Link>{" "}
                  <span className="text-zinc-500">
                    (week {upcomingWorkout.week}, day {upcomingWorkout.day})
                  </span>
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle>Weekly check-in</CardTitle>
          {weekCheckIn ? (
            <p className="mt-2 text-sm text-zinc-500">
              <Badge tone="green">Done</Badge> Submitted {formatDate(weekCheckIn.created_at, tz, "EEE, MMM d")}.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-500">Due this week. Two minutes to tell {coachName} how it&apos;s going.</p>
              <LinkButton href="/me/check-in" size="sm" className="mt-3">
                Check in
              </LinkButton>
            </>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Messages</CardTitle>
            {unread ? <Badge tone="brand">{unread} new</Badge> : null}
          </div>
          {lastMessage ? (
            <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
              {lastMessage.body ?? (lastMessage.kind === "text" ? "" : `Sent a ${lastMessage.kind.replace("_", " ")}`)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No messages yet. Questions? Message {coachName} any time.</p>
          )}
          <LinkButton href="/me/messages" size="sm" variant="outline" className="mt-3">
            {unread ? "Read messages" : "Open chat"}
          </LinkButton>
        </Card>

        <Card>
          <CardTitle>Credits & membership</CardTitle>
          <p className="mt-2 text-3xl font-bold tracking-tight">{credits ?? 0}</p>
          <p className="text-xs text-zinc-500">session credit{credits === 1 ? "" : "s"} remaining</p>
          {sub ? (
            <p className="mt-2 text-sm">
              {sub.offerings?.name ?? "Membership"}{" "}
              <Badge tone={sub.status === "active" || sub.status === "trialing" ? "green" : "red"}>{titleCase(sub.status)}</Badge>
              {sub.current_period_end ? (
                <span className="block text-xs text-zinc-500">
                  {sub.cancel_at_period_end ? "Ends" : "Renews"} {formatDate(sub.current_period_end, tz)}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No active membership.</p>
          )}
          <LinkButton href="/me/billing" size="sm" variant="outline" className="mt-3">
            Billing & credits
          </LinkButton>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Today&apos;s habits</CardTitle>
            <Link href="/me/progress" className="text-sm text-brand hover:underline">
              Track habits
            </Link>
          </div>
          {habits?.length ? (
            <ul className="mt-3 space-y-2">
              {habits.map((h) => {
                const done = h.habit_logs.some((l) => l.logged_on === today);
                const thisWeek = h.habit_logs.filter((l) => l.logged_on >= week.monday && l.logged_on <= today).length;
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border text-[11px] font-bold",
                          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600",
                        )}
                      >
                        {done ? "✓" : ""}
                      </span>
                      <span>
                        {h.name}
                        <span className="sr-only">{done ? " (done today)" : " (not yet today)"}</span>
                      </span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {thisWeek}/{h.target_per_week} this week
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No habits yet. Your coach can add daily habits to build alongside your training.</p>
          )}
        </Card>

        <Card>
          <CardTitle>From your coach</CardTitle>
          {responses.length ? (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {responses.map((r) => (
                <li key={r.key} className="py-2.5">
                  <Link href={r.href} className="text-sm font-medium hover:text-brand">
                    {r.title}
                  </Link>
                  {r.body ? <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{r.body}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyState title="No feedback yet" description="When your coach responds to workouts, check-ins or form checks, it shows up here." />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
