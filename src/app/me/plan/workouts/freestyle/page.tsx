import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInTz } from "@/lib/training/dates";
import { EXERCISE_FIELDS, exerciseLibraryFilter, preferredUnit } from "@/lib/training/server";
import { toLoggerExercise } from "../blocks";
import { WorkoutLogger } from "../workout-logger";

export const metadata = { title: "Log a workout" };

export default async function FreestylePage() {
  const { profile, business } = await requireClient();
  const supabase = await createClient();
  const [{ data: library }, unit] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_FIELDS).or(exerciseLibraryFilter(business.id)).order("name").limit(1000),
    preferredUnit(supabase, business.id, profile.id),
  ]);
  return (
    <div className="max-w-3xl">
      <Link href="/me/plan" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← My plan
      </Link>
      <PageHeader
        title="Log a freestyle workout"
        description="Trained on your own, did a class or went for a run? Log it so your coach sees the full picture."
      />
      <WorkoutLogger workoutId={null} initialBlocks={[]} library={(library ?? []).map(toLoggerExercise)} defaultDate={todayInTz(profile.timezone)} defaultUnit={unit} />
    </div>
  );
}
