import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, EmptyState, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { CheckInCard } from "@/components/training/check-in-card";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RATING_HINTS } from "@/lib/training/constants";
import { addDays, longDateLabel, todayInTz, weekStartMonday } from "@/lib/training/dates";
import { preferredUnit } from "@/lib/training/server";
import { submitCheckIn } from "./actions";

export const metadata = { title: "Weekly check-in" };

const RATINGS: { name: keyof typeof RATING_HINTS; label: string }[] = [
  { name: "sleep_quality", label: "Sleep quality" },
  { name: "energy_level", label: "Energy" },
  { name: "stress_level", label: "Stress" },
  { name: "nutrition_adherence", label: "Nutrition (sticking to the plan)" },
  { name: "training_adherence", label: "Training (sessions done)" },
];

export default async function CheckInPage() {
  const profile = await requireClient();
  const trainerId = await getClientTrainerId(profile.id);
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const weekOf = weekStartMonday(today);

  if (!trainerId) {
    return (
      <div>
        <PageHeader title="Weekly check-in" />
        <EmptyState title="No coach yet" description="Once you're connected with a coach you can check in each week here." />
      </div>
    );
  }

  const [{ data: history }, unit] = await Promise.all([
    supabase.from("check_ins").select("*").eq("client_id", profile.id).order("week_of", { ascending: false }).limit(26),
    preferredUnit(supabase, profile.id),
  ]);
  const current = (history ?? []).find((c) => c.week_of === weekOf && c.trainer_id === trainerId);
  const past = (history ?? []).filter((c) => c !== current);
  const weights = [...(history ?? [])].reverse().filter((c) => c.body_weight != null).map((c) => Number(c.body_weight));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Weekly check-in"
        description={`Week of ${longDateLabel(weekOf, { month: "long", day: "numeric" })} – ${longDateLabel(addDays(weekOf, 6), { month: "long", day: "numeric" })}. A quick look back helps your coach adjust your plan.`}
      />
      {current ? (
        <div className="mb-4">
          <Alert tone="green">
            You&apos;ve checked in this week{current.trainer_response ? " and your coach replied below" : ""}. You can still update it.
          </Alert>
        </div>
      ) : null}
      {current?.trainer_response ? (
        <div className="mb-4">
          <CheckInCard checkIn={current} weightUnit={unit} />
        </div>
      ) : null}

      <Card className="mb-8">
        <ActionForm action={submitCheckIn} className="flex flex-col gap-5">
          <Field label={`Body weight (${unit})`} htmlFor="body_weight" hint="Optional. Same scale, same time of day is best." className="max-w-xs">
            <Input id="body_weight" name="body_weight" type="number" step="0.1" min={40} max={1000} inputMode="decimal" defaultValue={current?.body_weight ?? ""} />
          </Field>
          {RATINGS.map(({ name, label }) => (
            <fieldset key={name}>
              <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</legend>
              <div className="mt-1.5 grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap">
                {RATING_HINTS[name].map((hint, i) => (
                  <label key={hint} className="cursor-pointer">
                    <input type="radio" name={name} value={i + 1} defaultChecked={current?.[name] === i + 1} className="peer sr-only" />
                    <span className="flex h-full flex-col items-center rounded-xl border border-zinc-300 px-2 py-1.5 text-center text-xs text-zinc-600 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 sm:min-w-20 dark:border-zinc-700 dark:text-zinc-400">
                      <span className="text-sm font-bold">{i + 1}</span>
                      <span className="leading-tight">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <Field label="Wins this week" htmlFor="wins">
            <Textarea id="wins" name="wins" rows={3} maxLength={2000} defaultValue={current?.wins ?? ""} placeholder="PRs, habits you nailed, how your clothes fit…" />
          </Field>
          <Field label="Struggles" htmlFor="struggles">
            <Textarea id="struggles" name="struggles" rows={3} maxLength={2000} defaultValue={current?.struggles ?? ""} />
          </Field>
          <Field label="Questions for your coach" htmlFor="questions">
            <Textarea id="questions" name="questions" rows={3} maxLength={2000} defaultValue={current?.questions ?? ""} />
          </Field>
          <div>
            <SubmitButton pendingLabel="Sending…">{current ? "Update check-in" : "Send check-in"}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">History</h2>
        {weights.length >= 2 ? <Sparkline values={weights} label="Check-in weight trend" /> : null}
      </div>
      {past.length === 0 ? (
        <EmptyState title="No past check-ins" description="Your previous weeks and your coach's replies will show here." />
      ) : (
        <div className="flex flex-col gap-3">
          {past.map((c) => (
            <CheckInCard key={c.id} checkIn={c} weightUnit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}
