import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { WorkoutLogItem } from "@/components/training/feedback";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/format";
import { longDateLabel, programWorkoutDate, todayInTz } from "@/lib/training/dates";
import { EXERCISE_FIELDS, exerciseLibraryFilter, getLastPerformance, loadLogs, loadWorkout, preferredUnit } from "@/lib/training/server";
import { blocksForWorkout, toLoggerExercise } from "../blocks";
import { WorkoutLogger } from "../workout-logger";

export const metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: PageProps<"/me/plan/workouts/[id]">) {
  const { id } = await params;
  const { profile, business } = await requireClient();
  const supabase = await createClient();
  const workout = await loadWorkout(supabase, id);
  if (!workout) notFound();
  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date, client_id, status")
    .eq("id", workout.program_id)
    .eq("business_id", business.id)
    .eq("client_id", profile.id)
    .maybeSingle();
  if (!program) notFound();

  const today = todayInTz(profile.timezone);
  const date = program.start_date ? programWorkoutDate(program.start_date, workout.week, workout.day) : null;
  const exerciseIds = [...new Set(workout.exercises.map((e) => e.exercise_id))];
  const [last, unit, previous, { data: library }] = await Promise.all([
    getLastPerformance(supabase, business.id, profile.id, exerciseIds),
    preferredUnit(supabase, business.id, profile.id),
    loadLogs(supabase, { businessId: business.id, clientId: profile.id, programId: program.id, limit: 100 }),
    supabase.from("exercises").select(EXERCISE_FIELDS).or(exerciseLibraryFilter(business.id)).order("name").limit(1000),
  ]);
  const pastLogs = previous.filter((l) => l.workout_id === workout.id);
  const blocks = blocksForWorkout(workout, last, unit);

  return (
    <div className="max-w-3xl">
      <Link href="/me/plan" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← My plan
      </Link>
      <PageHeader
        title={workout.name}
        description={
          <>
            {program.name} · Week {workout.week}, day {workout.day}
            {date ? ` · ${longDateLabel(date, { weekday: "long", month: "short", day: "numeric" })}` : ""}
            {workout.estimated_minutes ? ` · about ${formatDuration(workout.estimated_minutes)}` : ""}
          </>
        }
        actions={pastLogs.length ? <Badge tone="green">Done {pastLogs.length}×</Badge> : date === today ? <Badge tone="brand">Today</Badge> : null}
      />

      {workout.notes ? (
        <Card className="mb-4">
          <CardTitle>From your coach</CardTitle>
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{workout.notes}</p>
        </Card>
      ) : null}

      {pastLogs.length ? (
        <details className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer text-sm font-semibold">Previous sessions of this workout ({pastLogs.length})</summary>
          <div className="mt-3 flex flex-col gap-2">
            {pastLogs.map((log) => (
              <WorkoutLogItem key={log.id} log={log} />
            ))}
          </div>
        </details>
      ) : null}

      {workout.exercises.length === 0 ? (
        <p className="mb-4 text-sm text-zinc-500">Your coach hasn&apos;t added exercises to this workout yet. You can still log what you did.</p>
      ) : null}

      <WorkoutLogger
        workoutId={workout.id}
        initialBlocks={blocks}
        library={(library ?? []).map(toLoggerExercise)}
        defaultDate={date && date <= today ? date : today}
        defaultUnit={unit}
      />
    </div>
  );
}
