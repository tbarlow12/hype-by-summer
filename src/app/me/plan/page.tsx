import Link from "next/link";
import { Alert, Badge, Card, CardTitle, EmptyState, LinkButton, PageHeader, cn } from "@/components/ui";
import { ProgressBar } from "@/components/charts";
import { WorkoutLogItem } from "@/components/training/feedback";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adherenceByWeek, adherenceToDate } from "@/lib/training/adherence";
import { longDateLabel, programPosition, programWorkoutDate, shortDayLabel, todayInTz } from "@/lib/training/dates";
import { getActiveProgram, loadLogs, loadWorkouts } from "@/lib/training/server";

export const metadata = { title: "My plan" };

export default async function PlanPage({ searchParams }: PageProps<"/me/plan">) {
  const { profile, business } = await requireClient();
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const program = await getActiveProgram(supabase, business.id, profile.id);

  const [workouts, programLogs, recentLogs, feedbackRes, coachRes] = await Promise.all([
    program ? loadWorkouts(supabase, program.id) : Promise.resolve([]),
    program ? loadLogs(supabase, { businessId: business.id, clientId: profile.id, programId: program.id, limit: 300 }) : Promise.resolve([]),
    loadLogs(supabase, { businessId: business.id, clientId: profile.id, limit: 8 }),
    program
      ? supabase.from("program_feedback").select("week").eq("business_id", business.id).eq("program_id", program.id)
      : Promise.resolve({ data: [] as { week: number | null }[] }),
    program?.coach_id
      ? supabase.from("profiles").select("full_name").eq("id", program.coach_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const coachName = coachRes.data?.full_name?.trim() || null;

  const loggedLabel = sp.logged ? (
    <div className="mb-4">
      <Alert tone="green">Workout saved. Nice work! Your coach has been notified.</Alert>
    </div>
  ) : null;

  const header = (
    <PageHeader
      title="My plan"
      description={program ? program.goal ?? undefined : "Your training program and workout history."}
      actions={
        <>
          <LinkButton href="/me/plan/workouts/freestyle" variant="outline">Log a freestyle workout</LinkButton>
          {program ? <LinkButton href="/me/plan/feedback" variant="ghost">Program feedback</LinkButton> : null}
        </>
      }
    />
  );

  if (!program || !program.start_date) {
    return (
      <div>
        {header}
        {loggedLabel}
        <EmptyState
          title="No active program yet"
          description="Your coach will set one up for you. In the meantime you can log any workout you do."
          action={<LinkButton href="/me/plan/workouts/freestyle" size="sm">Log a workout</LinkButton>}
        />
        <RecentLogs logs={recentLogs} />
      </div>
    );
  }

  const start = program.start_date;
  const position = programPosition(start, program.duration_weeks, today);
  const started = today >= start;
  const currentWeek = position?.week ?? (started ? program.duration_weeks : null);
  const doneIds = new Set(programLogs.map((l) => l.workout_id));
  const weeks = adherenceByWeek(workouts, programLogs.map((l) => l.workout_id), program.duration_weeks);
  const overall = currentWeek
    ? adherenceToDate(workouts, programLogs.map((l) => l.workout_id), position ?? { week: currentWeek, day: 7 })
    : null;
  const todays = position ? workouts.filter((w) => w.week === position.week && w.day === position.day) : [];
  const nextUp = workouts.find((w) => !doneIds.has(w.id) && programWorkoutDate(start, w.week, w.day) >= today);

  // End-of-week feedback prompt: last two days of a week, or a past week left without feedback.
  const fbWeeks = new Set((feedbackRes.data ?? []).map((f) => f.week));
  let promptWeek: number | null = null;
  if (position && position.day >= 6 && !fbWeeks.has(position.week)) promptWeek = position.week;
  else if (currentWeek && currentWeek > 1 && !fbWeeks.has(currentWeek - 1) && weeks[currentWeek - 2]?.completed) promptWeek = currentWeek - 1;
  else if (!position && started && !fbWeeks.has(program.duration_weeks)) promptWeek = program.duration_weeks;

  return (
    <div>
      {header}
      {loggedLabel}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {position ? `Week ${position.week} of ${program.duration_weeks} · Day ${position.day}` : started ? "Program finished" : `Starts ${longDateLabel(start)}`}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{program.name}</h2>
          {coachName ? <p className="text-xs text-zinc-500">Coached by {coachName}</p> : null}
          {program.description ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{program.description}</p> : null}
          <div className="mt-4">
            {todays.length ? (
              <div className="flex flex-col gap-2">
                {todays.map((w) => (
                  <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand/5 p-3">
                    <div>
                      <p className="text-sm font-semibold">Today: {w.name}</p>
                      <p className="text-xs text-zinc-500">
                        {w.exercises.length} exercises{w.estimated_minutes ? ` · ~${w.estimated_minutes} min` : ""}
                      </p>
                    </div>
                    {doneIds.has(w.id) ? (
                      <Badge tone="green">Done</Badge>
                    ) : (
                      <LinkButton href={`/me/plan/workouts/${w.id}`} size="sm">Start workout</LinkButton>
                    )}
                  </div>
                ))}
              </div>
            ) : position ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Rest day today.{" "}
                {nextUp ? (
                  <>
                    Next up:{" "}
                    <Link className="font-medium text-brand hover:underline" href={`/me/plan/workouts/${nextUp.id}`}>
                      {nextUp.name}
                    </Link>{" "}
                    on {longDateLabel(programWorkoutDate(start, nextUp.week, nextUp.day), { weekday: "long", month: "short", day: "numeric" })}.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardTitle>Consistency</CardTitle>
          <p className="mt-1 text-3xl font-bold tracking-tight">{overall != null ? `${overall}%` : "–"}</p>
          <p className="text-xs text-zinc-500">of scheduled workouts done so far</p>
          {overall != null ? <ProgressBar className="mt-3" value={overall} label="Workouts completed" /> : null}
          <p className="mt-3 text-xs text-zinc-500">
            {programLogs.length} workout{programLogs.length === 1 ? "" : "s"} logged in this program
          </p>
        </Card>
      </div>

      {promptWeek ? (
        <div className="mb-6">
          <Alert tone="amber">
            <span className="font-semibold">How did week {promptWeek} feel?</span> Two minutes of feedback helps your coach tune the next week.{" "}
            <Link href={`/me/plan/feedback?week=${promptWeek}`} className="font-semibold underline">
              Give feedback
            </Link>
          </Alert>
        </div>
      ) : null}

      <section aria-labelledby="cal-h" className="mb-8">
        <h2 id="cal-h" className="mb-3 text-lg font-semibold">Program calendar</h2>
        {workouts.length === 0 ? (
          <EmptyState title="No workouts scheduled yet" description="Your coach is still building this program. Check back soon." />
        ) : (
          <div className="flex flex-col gap-3">
            {weeks.map((wk) => {
              const isCurrent = wk.week === position?.week;
              return (
                <Card key={wk.week} className={cn("p-3 sm:p-4", isCurrent && "border-brand/50")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-sm font-semibold", isCurrent && "text-brand")}>
                      Week {wk.week}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        {longDateLabel(programWorkoutDate(start, wk.week, 1), { month: "short", day: "numeric" })} – {longDateLabel(programWorkoutDate(start, wk.week, 7), { month: "short", day: "numeric" })}
                      </span>
                    </p>
                    {wk.prescribed ? (
                      <span className="text-xs text-zinc-500">
                        {wk.completed}/{wk.prescribed} done
                      </span>
                    ) : null}
                  </div>
                  <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-7">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const date = programWorkoutDate(start, wk.week, d);
                      const dayWorkouts = workouts.filter((w) => w.week === wk.week && w.day === d);
                      const isToday = date === today;
                      const past = date < today;
                      return (
                        <li
                          key={d}
                          aria-current={isToday ? "date" : undefined}
                          className={cn(
                            "rounded-xl border p-2 text-xs",
                            isToday ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-zinc-200 dark:border-zinc-800",
                            dayWorkouts.length === 0 && !isToday && "hidden sm:block",
                          )}
                        >
                          <p className={cn("font-medium", isToday ? "text-brand" : "text-zinc-500")}>
                            {shortDayLabel(date)}
                            {isToday ? " · Today" : ""}
                          </p>
                          {dayWorkouts.length === 0 ? <p className="mt-1 text-zinc-400">Rest</p> : null}
                          {dayWorkouts.map((w) => {
                            const done = doneIds.has(w.id);
                            return (
                              <Link
                                key={w.id}
                                href={`/me/plan/workouts/${w.id}`}
                                className={cn(
                                  "mt-1 flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800",
                                  done ? "text-emerald-700 dark:text-emerald-400" : past ? "text-zinc-400" : "text-zinc-800 dark:text-zinc-200",
                                )}
                              >
                                <span aria-hidden>{done ? "✓" : past ? "–" : "○"}</span>
                                <span className="truncate">{w.name}</span>
                                <span className="sr-only">{done ? "(completed)" : past ? "(missed)" : "(upcoming)"}</span>
                              </Link>
                            );
                          })}
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <RecentLogs logs={recentLogs} />
    </div>
  );
}

function RecentLogs({ logs }: { logs: Awaited<ReturnType<typeof loadLogs>> }) {
  return (
    <section aria-labelledby="recent-h" className="mt-8">
      <h2 id="recent-h" className="mb-3 text-lg font-semibold">Recent workouts</h2>
      {logs.length === 0 ? (
        <EmptyState title="Nothing logged yet" description="Finished workouts and your coach's replies will show up here." />
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((log) => (
            <WorkoutLogItem key={log.id} log={log} />
          ))}
        </div>
      )}
    </section>
  );
}
