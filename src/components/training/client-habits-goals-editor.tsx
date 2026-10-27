// Trainer-side editor for a client's habits and goals (embedded on /coach/clients/[id]).
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, Checkbox, Field, Input, Select } from "@/components/ui";
import { ProgressBar } from "@/components/charts";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createClientGoal,
  createClientHabit,
  deleteClientGoal,
  setClientHabitActive,
  updateClientGoal,
} from "@/lib/training/coach-actions";
import { countInWeek, currentStreak, goalProgress } from "@/lib/training/habits";
import { longDateLabel, todayInTz, weekStartMonday } from "@/lib/training/dates";
import { isTrainerOf } from "@/lib/training/server";
import { ConfirmSubmit } from "./confirm-submit";

export async function ClientHabitsGoalsEditor({ clientId }: { clientId: string }) {
  const trainer = await requireTrainer();
  const supabase = await createClient();
  if (!(await isTrainerOf(supabase, trainer.id, clientId))) return null;

  const [{ data: client }, { data: habits }, { data: goals }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", clientId).maybeSingle(),
    supabase
      .from("habits")
      .select("id, name, target_per_week, active, trainer_id, habit_logs(logged_on)")
      .eq("client_id", clientId)
      .order("active", { ascending: false })
      .order("created_at"),
    supabase.from("goals").select("*").eq("client_id", clientId).order("achieved_at", { ascending: true, nullsFirst: true }).order("created_at"),
  ]);
  const today = todayInTz(client?.timezone ?? trainer.timezone);
  const weekStart = weekStartMonday(today);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Habits</CardTitle>
        {!habits?.length ? (
          <p className="mt-2 text-sm text-zinc-500">No habits yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {habits.map((h) => {
              const logged = (h.habit_logs ?? []).map((l) => l.logged_on);
              const week = countInWeek(logged, weekStart);
              return (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className={h.active ? "truncate text-sm font-medium" : "truncate text-sm text-zinc-400 line-through"}>{h.name}</p>
                    <p className="text-xs text-zinc-500">
                      {week}/{h.target_per_week} this week · streak {currentStreak(logged, today)}d{h.trainer_id ? "" : " · client's own"}
                    </p>
                  </div>
                  <ActionForm action={setClientHabitActive.bind(null, h.id, !h.active)}>
                    <SubmitButton variant="ghost" size="sm">{h.active ? "Archive" : "Restore"}</SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={createClientHabit.bind(null, clientId)} resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Field label="New habit" htmlFor={`habit-${clientId}`} className="min-w-48 flex-1">
            <Input id={`habit-${clientId}`} name="name" required maxLength={120} placeholder="Protein at every meal" />
          </Field>
          <Field label="Days/week" htmlFor={`habit-t-${clientId}`}>
            <Select id={`habit-t-${clientId}`} name="target_per_week" defaultValue="7" className="w-20">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <SubmitButton>Add habit</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <CardTitle>Goals</CardTitle>
        {!goals?.length ? (
          <p className="mt-2 text-sm text-zinc-500">No goals yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {goals.map((g) => {
              const pct = goalProgress(g);
              return (
                <li key={g.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{g.title}</p>
                      <p className="text-xs text-zinc-500">
                        {g.current_value ?? "–"} → {g.target_value ?? "–"} {g.unit ?? ""}
                        {g.target_date ? ` · by ${longDateLabel(g.target_date)}` : ""}
                      </p>
                    </div>
                    {g.achieved_at ? <Badge tone="green">Achieved</Badge> : pct != null ? <Badge tone="brand">{pct}%</Badge> : null}
                  </div>
                  {pct != null ? <ProgressBar className="mt-2" value={g.achieved_at ? 100 : pct} label={`${g.title} progress`} /> : null}
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                    <ActionForm action={updateClientGoal.bind(null, g.id)} className="flex flex-wrap items-end gap-2">
                      <Field label="Current" htmlFor={`gcv-${g.id}`}>
                        <Input id={`gcv-${g.id}`} name="current_value" type="number" step="any" defaultValue={g.current_value ?? ""} className="h-9 w-28" />
                      </Field>
                      <Checkbox name="achieved" defaultChecked={!!g.achieved_at} label="Achieved" className="pb-2" />
                      <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteClientGoal.bind(null, g.id)}>
                      <ConfirmSubmit variant="ghost" confirm={`Remove the goal “${g.title}”?`}>Remove</ConfirmSubmit>
                    </ActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <details className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-semibold text-brand">Add a goal</summary>
          <ActionForm action={createClientGoal.bind(null, clientId)} resetOnSuccess className="mt-3 flex flex-col gap-3">
            <Field label="Goal" htmlFor={`goal-${clientId}`}>
              <Input id={`goal-${clientId}`} name="title" required maxLength={160} placeholder="Squat bodyweight for 5" />
            </Field>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Start" htmlFor={`gs-${clientId}`}>
                <Input id={`gs-${clientId}`} name="start_value" type="number" step="any" />
              </Field>
              <Field label="Target" htmlFor={`gt-${clientId}`}>
                <Input id={`gt-${clientId}`} name="target_value" type="number" step="any" />
              </Field>
              <Field label="Unit" htmlFor={`gu-${clientId}`}>
                <Input id={`gu-${clientId}`} name="unit" maxLength={20} placeholder="lb" />
              </Field>
              <Field label="Metric" htmlFor={`gm-${clientId}`}>
                <Input id={`gm-${clientId}`} name="metric" maxLength={80} placeholder="Squat 5RM" />
              </Field>
            </div>
            <Field label="Target date" htmlFor={`gd-${clientId}`}>
              <Input id={`gd-${clientId}`} name="target_date" type="date" min={today} className="w-48" />
            </Field>
            <div>
              <SubmitButton size="sm">Add goal</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
