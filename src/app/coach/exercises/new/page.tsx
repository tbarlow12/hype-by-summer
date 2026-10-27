import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createExercise } from "../actions";
import { ExerciseForm } from "../exercise-form";

export const metadata = { title: "New exercise" };

export default async function NewExercisePage() {
  await requireTrainer();
  return (
    <div className="max-w-3xl">
      <Link href="/coach/exercises" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Exercise library
      </Link>
      <PageHeader title="New exercise" description="Added to your private library. Clients see it when it's in their program." />
      <Card>
        <ExerciseForm action={createExercise} submitLabel="Create exercise" />
      </Card>
    </div>
  );
}
