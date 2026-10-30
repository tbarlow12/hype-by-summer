import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, EmptyState, Field, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ProgramFeedbackItem } from "@/components/training/feedback";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { programPosition, todayInTz } from "@/lib/training/dates";
import { getActiveProgram } from "@/lib/training/server";
import { submitProgramFeedback } from "../actions";

export const metadata = { title: "Program feedback" };

function Choice({ name, options, legend }: { name: string; options: [string, string][]; legend: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map(([value, label]) => (
          <label key={value} className="cursor-pointer">
            <input type="radio" name={name} value={value} required className="peer sr-only" />
            <span className="inline-flex items-center rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 dark:border-zinc-700 dark:text-zinc-400">
              {label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function ProgramFeedbackPage({ searchParams }: PageProps<"/me/plan/feedback">) {
  const { profile, business } = await requireClient();
  const sp = await searchParams;
  const supabase = await createClient();
  const program = await getActiveProgram(supabase, business.id, profile.id);
  const { data: history } = await supabase
    .from("program_feedback")
    .select("*, program:programs(name), responder:profiles!program_feedback_responded_by_fkey(full_name)")
    .eq("business_id", business.id)
    .eq("client_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const today = todayInTz(profile.timezone);
  const pos = program?.start_date ? programPosition(program.start_date, program.duration_weeks, today) : null;
  const requested = Number(typeof sp.week === "string" ? sp.week : NaN);
  const defaultWeek = Number.isInteger(requested) && requested >= 1 && program && requested <= program.duration_weeks ? requested : (pos?.week ?? program?.duration_weeks ?? 1);

  return (
    <div className="max-w-3xl">
      <Link href="/me/plan" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← My plan
      </Link>
      <PageHeader title="Program feedback" description="Tell your coach how the plan is working so it keeps fitting your life." />

      {program ? (
        <Card className="mb-8">
          <ActionForm action={submitProgramFeedback} resetOnSuccess className="flex flex-col gap-5">
            <input type="hidden" name="program_id" value={program.id} />
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">{program.name}</p>
                <p className="text-sm text-zinc-500">Which week are you reviewing?</p>
              </div>
              <Field label="Week" htmlFor="week" className="w-36">
                <Select id="week" name="week" defaultValue={String(defaultWeek)}>
                  {Array.from({ length: program.duration_weeks }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                  <option value="">Whole program</option>
                </Select>
              </Field>
            </div>
            <Choice name="overall_rating" legend="Overall, how are you liking it?" options={[["1", "1 · Not for me"], ["2", "2"], ["3", "3 · OK"], ["4", "4"], ["5", "5 · Love it"]]} />
            <Choice name="difficulty" legend="Difficulty" options={[["too_easy", "Too easy"], ["just_right", "Just right"], ["too_hard", "Too hard"]]} />
            <Choice name="volume" legend="Amount of work" options={[["too_little", "Too little"], ["just_right", "Just right"], ["too_much", "Too much"]]} />
            <Field label="Favorite parts" htmlFor="favorite_parts">
              <Textarea id="favorite_parts" name="favorite_parts" rows={2} maxLength={2000} />
            </Field>
            <Field label="Least favorite parts" htmlFor="least_favorite_parts">
              <Textarea id="least_favorite_parts" name="least_favorite_parts" rows={2} maxLength={2000} />
            </Field>
            <Field label="Anything you'd like changed?" htmlFor="requested_changes" hint="Exercises to swap, schedule changes, equipment you don't have…">
              <Textarea id="requested_changes" name="requested_changes" rows={3} maxLength={2000} />
            </Field>
            <div>
              <SubmitButton pendingLabel="Sending…">Send feedback</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : (
        <div className="mb-8">
          <EmptyState title="No active program" description="Once your coach assigns a program you can tell them how it's going here." action={<LinkButton href="/me/plan" size="sm">Back to my plan</LinkButton>} />
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Your past feedback</h2>
      {!history?.length ? (
        <EmptyState title="No feedback yet" description="Your feedback and your coach's replies will appear here." />
      ) : (
        <div className="flex flex-col gap-2">
          {history.map(({ program: p, ...fb }) => (
            <div key={fb.id}>
              <p className="mb-1 text-xs text-zinc-500">{p?.name}</p>
              <ProgramFeedbackItem fb={fb} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
