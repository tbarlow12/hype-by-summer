import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/training/confirm-submit";
import { VideoEmbed } from "@/components/training/video-embed";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { titleCase } from "@/lib/format";
import { EXERCISE_FIELDS } from "@/lib/training/server";
import { exerciseUsableBy } from "@/lib/training/routing";
import { deleteExercise, duplicateExercise, updateExercise } from "../actions";
import { ExerciseForm } from "../exercise-form";

export const metadata = { title: "Exercise" };

export default async function ExercisePage({ params, searchParams }: PageProps<"/coach/exercises/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { business } = await requireStaff();
  const supabase = await createClient();
  const { data: ex } = await supabase.from("exercises").select(EXERCISE_FIELDS).eq("id", id).maybeSingle();
  if (!ex || !exerciseUsableBy(ex, business.id)) notFound();
  const own = ex.business_id === business.id;

  const { count: usage } = await supabase
    .from("workout_exercises")
    .select("id, workout:program_workouts!inner(program:programs!inner(business_id))", { count: "exact", head: true })
    .eq("exercise_id", id)
    .eq("workout.program.business_id", business.id);

  return (
    <div className="max-w-3xl">
      <Link href="/coach/exercises" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Exercise library
      </Link>
      <PageHeader
        title={ex.name}
        description={own ? `Your team's exercise · used in ${usage ?? 0} program workout${usage === 1 ? "" : "s"}` : "Global library exercise"}
        actions={
          <>
            <ActionForm action={duplicateExercise.bind(null, ex.id)}>
              <SubmitButton variant="outline" size="sm" pendingLabel="Copying…">
                {own ? "Duplicate" : "Duplicate to customize"}
              </SubmitButton>
            </ActionForm>
            {own ? (
              <ActionForm action={deleteExercise.bind(null, ex.id)}>
                <ConfirmSubmit variant="danger" confirm={`Delete “${ex.name}”? This can't be undone.`} pendingLabel="Deleting…">
                  Delete
                </ConfirmSubmit>
              </ActionForm>
            ) : null}
          </>
        }
      />
      {sp.saved || sp.copied ? (
        <div className="mb-4">
          <Alert tone="green">{sp.copied ? "Copied into your library. Customize it below." : "Exercise created."}</Alert>
        </div>
      ) : null}

      {own ? (
        <Card>
          <ExerciseForm action={updateExercise.bind(null, ex.id)} initial={ex} submitLabel="Save changes" />
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {ex.category ? <Badge tone="brand">{titleCase(ex.category)}</Badge> : null}
            {ex.is_unilateral ? <Badge tone="purple">Unilateral</Badge> : null}
            {ex.primary_muscles.map((m) => (
              <Badge key={m}>{titleCase(m)}</Badge>
            ))}
          </div>
          {ex.equipment.length ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium">Equipment:</span> {ex.equipment.map(titleCase).join(", ")}
            </p>
          ) : null}
          <VideoEmbed url={ex.demo_video_url} title={`${ex.name} demo`} />
          {ex.instructions ? (
            <div>
              <CardTitle>Instructions</CardTitle>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{ex.instructions}</p>
            </div>
          ) : null}
          {ex.coaching_cues.length ? (
            <div>
              <CardTitle>Coaching cues</CardTitle>
              <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {ex.coaching_cues.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-zinc-500">Global exercises are shared and read-only. Duplicate it to add your own cues or video.</p>
        </Card>
      )}
    </div>
  );
}
