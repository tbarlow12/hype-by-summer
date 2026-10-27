// OWNER: training. Server component rendered on the coach's client detail page
// (/coach/clients/[id]): active program + adherence, recent workout logs and
// feedback, latest check-in, body metrics trend, PRs, open form-check count.
import Link from "next/link";
import { Badge, Card, CardTitle, LinkButton } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adherenceByWeek, feedbackFlags, overallAdherence } from "@/lib/training/adherence";
import { respondToCheckIn, respondToProgramFeedback, respondToWorkoutLog } from "@/lib/training/coach-actions";
import { longDateLabel, programPosition, todayInTz } from "@/lib/training/dates";
import { recentPRs } from "@/lib/training/records";
import { getActiveProgram, getPersonalRecords, isTrainerOf, loadLogs, loadWorkouts } from "@/lib/training/server";
import { CheckInCard } from "./check-in-card";
import { AdherenceBars, FlagBadges, ProgramFeedbackItem, WorkoutLogItem } from "./feedback";

export async function ClientTrainingSummary({ clientId }: { clientId: string }) {
  const trainer = await requireTrainer();
  const supabase = await createClient();
  if (!(await isTrainerOf(supabase, trainer.id, clientId))) return null;
  const today = todayInTz(trainer.timezone);

  const program = await getActiveProgram(supabase, clientId);
  const [workouts, programLogs, recent, checkInRes, metricsRes, videosRes, feedbackRes, prs] = await Promise.all([
    program ? loadWorkouts(supabase, program.id) : Promise.resolve([]),
    program ? loadLogs(supabase, { clientId, programId: program.id, limit: 300 }) : Promise.resolve([]),
    loadLogs(supabase, { clientId, limit: 5 }),
    supabase
      .from("check_ins")
      .select("*")
      .eq("client_id", clientId)
      .eq("trainer_id", trainer.id)
      .order("week_of", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("body_metrics")
      .select("measured_on, weight, unit_system")
      .eq("client_id", clientId)
      .not("weight", "is", null)
      .order("measured_on", { ascending: false })
      .limit(20),
    supabase
      .from("video_submissions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("trainer_id", trainer.id)
      .eq("status", "pending_review"),
    program
      ? supabase
          .from("program_feedback")
          .select("*")
          .eq("program_id", program.id)
          .is("trainer_response", null)
          .order("created_at", { ascending: false })
          .limit(2)
      : Promise.resolve({ data: [] }),
    getPersonalRecords(supabase, clientId),
  ]);

  const position = program?.start_date ? programPosition(program.start_date, program.duration_weeks, today) : null;
  const currentWeek = position?.week ?? (program?.start_date && program.start_date <= today ? program.duration_weeks : null);
  const weeks = program ? adherenceByWeek(workouts, programLogs.map((l) => l.workout_id), program.duration_weeks) : [];
  const overall = currentWeek ? overallAdherence(weeks, currentWeek) : null;
  const flags = feedbackFlags(recent);
  const weights = [...(metricsRes.data ?? [])].reverse();
  const weightUnit = weights[weights.length - 1]?.unit_system === "metric" ? "kg" : "lb";
  const lastWeight = weights[weights.length - 1];
  const firstWeight = weights[0];
  const openVideos = videosRes.count ?? 0;
  const checkIn = checkInRes.data;
  const topPRs = recentPRs(prs, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Active program</CardTitle>
              {program ? (
                <p className="mt-0.5 text-sm text-zinc-500">
                  <Link href={`/coach/programs/${program.id}`} className="font-medium text-brand hover:underline">
                    {program.name}
                  </Link>
                  {position ? ` · week ${position.week} of ${program.duration_weeks}` : program.start_date ? ` · starts ${longDateLabel(program.start_date)}` : ""}
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-zinc-500">No active program.</p>
              )}
            </div>
            {program ? (
              <span className="text-2xl font-bold tracking-tight">{overall != null ? `${overall}%` : "–"}</span>
            ) : (
              <LinkButton href={`/coach/programs/new?client=${clientId}`} size="sm">Create program</LinkButton>
            )}
          </div>
          {program ? (
            <div className="mt-3">
              <AdherenceBars weeks={weeks} currentWeek={currentWeek} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">Or open a template under Programs and assign it.</p>
          )}
          {flags.length ? (
            <div className="mt-3">
              <FlagBadges flags={flags} />
            </div>
          ) : null}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Weight trend</p>
            {lastWeight ? (
              <>
                <p className="mt-1 text-xl font-bold tracking-tight">
                  {Number(lastWeight.weight)} {weightUnit}
                  {firstWeight && weights.length > 1 ? (
                    <span className="ml-1 text-xs font-medium text-zinc-500">
                      ({Number(lastWeight.weight) - Number(firstWeight.weight) >= 0 ? "+" : ""}
                      {(Number(lastWeight.weight) - Number(firstWeight.weight)).toFixed(1)})
                    </span>
                  ) : null}
                </p>
                <Sparkline className="mt-1" values={weights.map((w) => Number(w.weight))} label="Body weight trend" />
              </>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">No weigh-ins yet</p>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Open form checks</p>
            <p className="mt-1 text-xl font-bold tracking-tight">{openVideos}</p>
            {openVideos ? (
              <Link href="/coach/videos" className="text-xs font-medium text-brand hover:underline">
                Review now
              </Link>
            ) : (
              <p className="text-xs text-zinc-500">All reviewed</p>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby={`logs-${clientId}`}>
          <h3 id={`logs-${clientId}`} className="mb-2 text-base font-semibold">Recent workouts</h3>
          {recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">No workouts logged yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((log) => (
                <WorkoutLogItem key={log.id} log={log} respondAction={respondToWorkoutLog.bind(null, log.id)} />
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section aria-labelledby={`ci-${clientId}`}>
            <h3 id={`ci-${clientId}`} className="mb-2 text-base font-semibold">Latest check-in</h3>
            {checkIn ? (
              <CheckInCard checkIn={checkIn} respondAction={respondToCheckIn.bind(null, checkIn.id)} weightUnit={weightUnit} />
            ) : (
              <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">No check-ins yet.</p>
            )}
          </section>

          {feedbackRes.data?.length ? (
            <section aria-labelledby={`pf-${clientId}`}>
              <h3 id={`pf-${clientId}`} className="mb-2 flex items-center gap-2 text-base font-semibold">
                Program feedback <Badge tone="amber">Needs reply</Badge>
              </h3>
              <div className="flex flex-col gap-2">
                {feedbackRes.data.map((fb) => (
                  <ProgramFeedbackItem key={fb.id} fb={fb} respondAction={respondToProgramFeedback.bind(null, fb.id)} />
                ))}
              </div>
            </section>
          ) : null}

          <Card>
            <CardTitle>Personal records</CardTitle>
            {topPRs.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No weighted sets logged yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {topPRs.map((pr) => (
                  <li key={pr.exercise_id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="truncate font-medium">{pr.exercise_name}</span>
                    <span className="shrink-0 text-right text-xs text-zinc-500">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {pr.best1RM.weight}×{pr.best1RM.reps}
                      </span>{" "}
                      · e1RM {pr.best1RM.estimate} {pr.best1RM.unit} · {longDateLabel(pr.best1RM.performed_on, { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
