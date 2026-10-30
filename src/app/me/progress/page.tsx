import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, Checkbox, EmptyState, Field, Input, PageHeader, Select, Table, Textarea, buttonClass } from "@/components/ui";
import { LineChart, ProgressBar } from "@/components/charts";
import { ConfirmSubmit } from "@/components/training/confirm-submit";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { goalProgress } from "@/lib/training/habits";
import { addDays, longDateLabel, todayInTz, weekDates, weekStartMonday } from "@/lib/training/dates";
import { getPersonalRecords } from "@/lib/training/server";
import { titleCase } from "@/lib/format";
import { addBodyMetric, archiveHabit, createGoal, createHabit, deleteBodyMetric, deleteGoal, deleteProgressPhoto, updateGoal } from "./actions";
import { HabitGrid } from "./habit-grid";
import { PhotoUploader } from "./photo-uploader";

export const metadata = { title: "Progress" };

const MEASUREMENTS = ["waist", "hips", "chest", "arm", "thigh"] as const;

export default async function ProgressPage({ searchParams }: PageProps<"/me/progress">) {
  const { profile, business } = await requireClient();
  const sp = await searchParams;
  const supabase = await createClient();
  const today = todayInTz(profile.timezone);
  const weekStart = weekStartMonday(today);

  const [{ data: metrics }, { data: photos }, { data: habits }, { data: goals }, prs] = await Promise.all([
    supabase.from("body_metrics").select("*").eq("business_id", business.id).eq("client_id", profile.id).order("measured_on", { ascending: true }).limit(500),
    supabase.from("progress_photos").select("*").eq("business_id", business.id).eq("client_id", profile.id).order("taken_on", { ascending: false }).limit(200),
    supabase
      .from("habits")
      .select("id, name, target_per_week, created_by, active, habit_logs(logged_on)")
      .eq("business_id", business.id)
      .eq("client_id", profile.id)
      .eq("active", true)
      .order("created_at"),
    supabase.from("goals").select("*").eq("business_id", business.id).eq("client_id", profile.id).order("achieved_at", { ascending: true, nullsFirst: true }).order("created_at"),
    getPersonalRecords(supabase, business.id, profile.id),
  ]);

  const rows = metrics ?? [];
  const latest = rows[rows.length - 1];
  const metric = latest?.unit_system === "metric";
  const wUnit = metric ? "kg" : "lb";
  const lUnit = metric ? "cm" : "in";
  const weightPts = rows.filter((m) => m.weight != null).map((m) => ({ x: m.measured_on, y: Number(m.weight) }));
  const bfPts = rows.filter((m) => m.body_fat_pct != null).map((m) => ({ x: m.measured_on, y: Number(m.body_fat_pct) }));
  const measureSeries = MEASUREMENTS.map((k) => ({
    label: titleCase(k),
    points: rows.filter((m) => m[k] != null).map((m) => ({ x: m.measured_on, y: Number(m[k]) })),
  })).filter((s) => s.points.length);
  const firstWeight = weightPts[0]?.y;
  const lastWeight = weightPts[weightPts.length - 1]?.y;

  // Photos: signed URLs (private bucket) + side-by-side compare.
  const photoList = photos ?? [];
  const { data: signed } = photoList.length
    ? await supabase.storage.from("progress-photos").createSignedUrls(photoList.map((p) => p.storage_path), 60 * 60)
    : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const pick = (v: unknown) => (typeof v === "string" ? photoList.find((p) => p.id === v) : undefined);
  const oldest = [...photoList].reverse();
  const defaultA = oldest.find((p) => p.pose === photoList[0]?.pose && p.id !== photoList[0]?.id);
  const compareA = pick(sp.a) ?? defaultA;
  const compareB = pick(sp.b) ?? (defaultA ? photoList[0] : undefined);
  const byDate = new Map<string, typeof photoList>();
  for (const p of photoList) byDate.set(p.taken_on, [...(byDate.get(p.taken_on) ?? []), p]);

  const days = weekDates(weekStart);
  const habitItems = (habits ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    target_per_week: h.target_per_week,
    byCoach: !!h.created_by && h.created_by !== profile.id,
    logged: (h.habit_logs ?? []).map((l) => l.logged_on).filter((d) => d >= addDays(today, -400)),
  }));

  return (
    <div>
      <PageHeader title="Progress" description="Measurements, photos, habits, goals and personal records in one place." />
      <nav aria-label="Sections" className="mb-6 flex gap-2 overflow-x-auto">
        {[
          ["#metrics", "Body"],
          ["#photos", "Photos"],
          ["#habits", "Habits"],
          ["#goals", "Goals"],
          ["#records", "PRs"],
        ].map(([href, label]) => (
          <a key={href} href={href} className={buttonClass("outline", "sm", "shrink-0")}>
            {label}
          </a>
        ))}
      </nav>

      {/* Body metrics ---------------------------------------------------- */}
      <section id="metrics" aria-labelledby="metrics-h" className="mb-10 scroll-mt-6">
        <h2 id="metrics-h" className="mb-3 text-lg font-semibold">Body metrics</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Weight</CardTitle>
              {lastWeight != null ? (
                <p className="text-sm text-zinc-500">
                  <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{lastWeight}</span> {wUnit}
                  {firstWeight != null && weightPts.length > 1 ? (
                    <span className="ml-2">
                      ({lastWeight - firstWeight >= 0 ? "+" : ""}
                      {(lastWeight - firstWeight).toFixed(1)} since {longDateLabel(weightPts[0]!.x, { month: "short", day: "numeric" })})
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <LineChart className="mt-3" title="Body weight over time" series={[{ label: "Weight", points: weightPts }]} unit={wUnit} />
          </Card>
          <Card>
            <CardTitle>Log measurements</CardTitle>
            <ActionForm action={addBodyMetric} resetOnSuccess className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date" htmlFor="measured_on">
                  <Input id="measured_on" name="measured_on" type="date" max={today} defaultValue={today} required />
                </Field>
                <Field label="Units" htmlFor="unit_system">
                  <Select id="unit_system" name="unit_system" defaultValue={latest?.unit_system ?? "imperial"}>
                    <option value="imperial">lb / in</option>
                    <option value="metric">kg / cm</option>
                  </Select>
                </Field>
                <Field label="Weight" htmlFor="weight">
                  <Input id="weight" name="weight" type="number" step="0.1" inputMode="decimal" />
                </Field>
                <Field label="Body fat %" htmlFor="body_fat_pct">
                  <Input id="body_fat_pct" name="body_fat_pct" type="number" step="0.1" inputMode="decimal" />
                </Field>
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand">Tape measurements & resting HR</summary>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {MEASUREMENTS.map((k) => (
                    <Field key={k} label={titleCase(k)} htmlFor={k}>
                      <Input id={k} name={k} type="number" step="0.1" inputMode="decimal" />
                    </Field>
                  ))}
                  <Field label="Resting HR" htmlFor="resting_hr">
                    <Input id="resting_hr" name="resting_hr" type="number" inputMode="numeric" />
                  </Field>
                </div>
              </details>
              <Field label="Notes" htmlFor="m-notes">
                <Textarea id="m-notes" name="notes" rows={2} maxLength={1000} className="min-h-12" />
              </Field>
              <div>
                <SubmitButton size="sm">Save</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          {measureSeries.length ? (
            <Card className="lg:col-span-2">
              <CardTitle>Measurements ({lUnit})</CardTitle>
              <LineChart className="mt-3" title="Tape measurements over time" series={measureSeries} unit={lUnit} />
            </Card>
          ) : null}
          {bfPts.length ? (
            <Card>
              <CardTitle>Body fat %</CardTitle>
              <LineChart className="mt-3" height={180} title="Body fat percentage over time" series={[{ label: "Body fat", points: bfPts }]} unit="%" />
            </Card>
          ) : null}
        </div>
        {rows.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-400">All entries ({rows.length})</summary>
            <div className="mt-2">
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Weight</th>
                    <th>BF%</th>
                    <th>Waist</th>
                    <th>Notes</th>
                    <th className="sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().slice(0, 60).map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{longDateLabel(m.measured_on)}</td>
                      <td>{m.weight != null ? `${Number(m.weight)} ${m.unit_system === "metric" ? "kg" : "lb"}` : "–"}</td>
                      <td>{m.body_fat_pct ?? "–"}</td>
                      <td>{m.waist ?? "–"}</td>
                      <td className="max-w-48 truncate text-zinc-500">{m.notes}</td>
                      <td className="text-right">
                        <ActionForm action={deleteBodyMetric.bind(null, m.id)}>
                          <ConfirmSubmit variant="ghost" confirm="Delete this entry?">Delete</ConfirmSubmit>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        ) : null}
      </section>

      {/* Photos ------------------------------------------------------------ */}
      <section id="photos" aria-labelledby="photos-h" className="mb-10 scroll-mt-6">
        <h2 id="photos-h" className="mb-3 text-lg font-semibold">Progress photos</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardTitle>Add photos</CardTitle>
            <div className="mt-3">
              <PhotoUploader clientId={profile.id} today={today} />
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardTitle>Compare</CardTitle>
            {photoList.length < 2 ? (
              <p className="mt-2 text-sm text-zinc-500">Upload at least two photos to compare them side by side.</p>
            ) : (
              <>
                <form method="get" action="/me/progress#photos" className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  {(["a", "b"] as const).map((k) => (
                    <Select key={k} name={k} aria-label={k === "a" ? "Before photo" : "After photo"} defaultValue={(k === "a" ? compareA : compareB)?.id}>
                      {photoList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {longDateLabel(p.taken_on)} · {titleCase(p.pose ?? "other")}
                        </option>
                      ))}
                    </Select>
                  ))}
                  <button type="submit" className={buttonClass("secondary", "md")}>Compare</button>
                </form>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[compareA, compareB].map((p, i) =>
                    p ? (
                      <figure key={`${p.id}-${i}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urlFor.get(p.storage_path) ?? ""} alt={`${titleCase(p.pose ?? "other")} photo from ${longDateLabel(p.taken_on)}`} className="aspect-[3/4] w-full rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
                        <figcaption className="mt-1 text-center text-xs text-zinc-500">
                          {i === 0 ? "Before" : "After"} · {longDateLabel(p.taken_on)}
                        </figcaption>
                      </figure>
                    ) : null,
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
        {photoList.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No photos yet" description="Photos every 2-4 weeks in the same light and pose show changes the scale misses." />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {[...byDate.entries()].map(([date, list]) => (
              <div key={date}>
                <p className="mb-2 text-sm font-semibold">{longDateLabel(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {list.map((p) => (
                    <li key={p.id} className="group relative">
                      <a href={urlFor.get(p.storage_path) ?? "#"} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urlFor.get(p.storage_path) ?? ""} alt={`${titleCase(p.pose ?? "other")} photo, ${longDateLabel(p.taken_on)}`} loading="lazy" className="aspect-[3/4] w-full rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
                      </a>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <Badge>{titleCase(p.pose ?? "other")}</Badge>
                        <ActionForm action={deleteProgressPhoto.bind(null, p.id)}>
                          <ConfirmSubmit variant="ghost" size="sm" confirm="Delete this photo?" className="h-6 px-2 text-xs">
                            Delete
                          </ConfirmSubmit>
                        </ActionForm>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Habits ------------------------------------------------------------ */}
      <section id="habits" aria-labelledby="habits-h" className="mb-10 scroll-mt-6">
        <h2 id="habits-h" className="mb-3 text-lg font-semibold">Habits</h2>
        <Card>
          {habitItems.length === 0 ? (
            <p className="text-sm text-zinc-500">No habits yet. Small daily wins add up. Add one below or ask your coach.</p>
          ) : (
            <HabitGrid key={habitItems.map((h) => h.id).join()} habits={habitItems} days={days} today={today} />
          )}
          <div className="mt-4 flex flex-col gap-4 border-t border-zinc-100 pt-4 sm:flex-row sm:items-end sm:justify-between dark:border-zinc-800">
            <ActionForm action={createHabit} resetOnSuccess className="flex flex-wrap items-end gap-2">
              <Field label="New habit" htmlFor="habit-name">
                <Input id="habit-name" name="name" required maxLength={120} placeholder="10k steps" className="w-56" />
              </Field>
              <Field label="Days / week" htmlFor="habit-target">
                <Select id="habit-target" name="target_per_week" defaultValue="7" className="w-24">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton size="md">Add</SubmitButton>
            </ActionForm>
            {habitItems.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-zinc-500">Archive a habit</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {habitItems.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{h.name}</span>
                      <ActionForm action={archiveHabit.bind(null, h.id)}>
                        <ConfirmSubmit variant="ghost" confirm={`Archive “${h.name}”? Its history is kept.`}>Archive</ConfirmSubmit>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      </section>

      {/* Goals ------------------------------------------------------------- */}
      <section id="goals" aria-labelledby="goals-h" className="mb-10 scroll-mt-6">
        <h2 id="goals-h" className="mb-3 text-lg font-semibold">Goals</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-3 lg:col-span-2">
            {!goals?.length ? (
              <EmptyState title="No goals yet" description="Set a goal with a target and update it as you go." />
            ) : (
              goals.map((g) => {
                const pct = goalProgress(g);
                return (
                  <Card key={g.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{g.title}</p>
                        <p className="text-xs text-zinc-500">
                          {g.target_value != null ? `Target ${g.target_value}${g.unit ? ` ${g.unit}` : ""}` : "No numeric target"}
                          {g.target_date ? ` by ${longDateLabel(g.target_date)}` : ""}
                          {g.created_by && g.created_by !== profile.id ? " · set with your coach" : ""}
                        </p>
                      </div>
                      {g.achieved_at ? <Badge tone="green">Achieved {longDateLabel(g.achieved_at.slice(0, 10), { month: "short", day: "numeric" })}</Badge> : pct != null ? <Badge tone="brand">{pct}%</Badge> : null}
                    </div>
                    {pct != null ? <ProgressBar className="mt-3" value={g.achieved_at ? 100 : pct} label={`${g.title} progress`} /> : null}
                    <ActionForm action={updateGoal.bind(null, g.id)} className="mt-3 flex flex-wrap items-end gap-3">
                      <Field label={`Current${g.unit ? ` (${g.unit})` : ""}`} htmlFor={`cv-${g.id}`}>
                        <Input id={`cv-${g.id}`} name="current_value" type="number" step="any" defaultValue={g.current_value ?? ""} className="w-32" />
                      </Field>
                      <Checkbox name="achieved" defaultChecked={!!g.achieved_at} label="Achieved" className="pb-2" />
                      <SubmitButton size="sm" variant="outline">Update</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteGoal.bind(null, g.id)} className="mt-2">
                      <ConfirmSubmit variant="ghost" confirm={`Remove the goal “${g.title}”?`} className="px-0 text-xs text-zinc-500">
                        Remove goal
                      </ConfirmSubmit>
                    </ActionForm>
                  </Card>
                );
              })
            )}
          </div>
          <Card>
            <CardTitle>New goal</CardTitle>
            <ActionForm action={createGoal} resetOnSuccess className="mt-3 flex flex-col gap-3">
              <Field label="Goal" htmlFor="goal-title">
                <Input id="goal-title" name="title" required maxLength={160} placeholder="Deadlift 225 lb" />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Start" htmlFor="goal-start">
                  <Input id="goal-start" name="start_value" type="number" step="any" />
                </Field>
                <Field label="Target" htmlFor="goal-target">
                  <Input id="goal-target" name="target_value" type="number" step="any" />
                </Field>
                <Field label="Unit" htmlFor="goal-unit">
                  <Input id="goal-unit" name="unit" maxLength={20} placeholder="lb" />
                </Field>
              </div>
              <Field label="Target date" htmlFor="goal-date">
                <Input id="goal-date" name="target_date" type="date" min={today} />
              </Field>
              <div>
                <SubmitButton size="sm">Add goal</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      </section>

      {/* Personal records -------------------------------------------------- */}
      <section id="records" aria-labelledby="records-h" className="scroll-mt-6">
        <h2 id="records-h" className="mb-1 text-lg font-semibold">Personal records</h2>
        <p className="mb-3 text-sm text-zinc-500">From your logged sets. Estimated 1RM uses the Epley formula.</p>
        {prs.length === 0 ? (
          <EmptyState title="No PRs yet" description="Log weighted sets in your workouts and your bests will show up here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Heaviest</th>
                <th>Best est. 1RM</th>
                <th>Most reps</th>
              </tr>
            </thead>
            <tbody>
              {prs.map((pr) => (
                <tr key={pr.exercise_id}>
                  <td className="font-medium">{pr.exercise_name}</td>
                  <td className="whitespace-nowrap">
                    {pr.heaviest.weight} {pr.heaviest.unit} × {pr.heaviest.reps}
                    <span className="block text-xs text-zinc-500">{longDateLabel(pr.heaviest.performed_on)}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold">{pr.best1RM.estimate} {pr.best1RM.unit}</span>
                    <span className="block text-xs text-zinc-500">
                      from {pr.best1RM.weight}×{pr.best1RM.reps} · {longDateLabel(pr.best1RM.performed_on)}
                    </span>
                  </td>
                  <td>{pr.mostReps}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
