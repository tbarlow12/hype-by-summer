"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Checkbox, Input, Label, Select, Textarea, cn } from "@/components/ui";
import { VideoEmbed } from "@/components/training/video-embed";
import { DIFFICULTY_LABELS } from "@/lib/training/adherence";
import { EXERCISE_CATEGORIES } from "@/lib/training/constants";
import { longDateLabel } from "@/lib/training/dates";
import { buildPrefill, summarizeSets, type PrefillSet } from "@/lib/training/prefill";
import { titleCase } from "@/lib/format";
import { lastPerformance, logWorkout } from "../actions";

export type LoggerExercise = {
  id: string;
  name: string;
  category: string | null;
  demo_video_url: string | null;
  coaching_cues: string[];
  instructions: string | null;
  is_unilateral: boolean;
};

export type LoggerBlock = {
  key: string;
  workout_exercise_id: string | null;
  exercise: LoggerExercise;
  prescription: {
    sets: number;
    reps: string | null;
    load: string | null;
    rest_seconds: number | null;
    tempo: string | null;
    notes: string | null;
    superset_label: string | null;
  } | null;
  lastTime: { performed_on: string; summary: string } | null;
  sets: PrefillSet[];
};

type SetState = {
  reps: string;
  weight: string;
  weight_unit: "lb" | "kg";
  duration_seconds: string;
  rpe: string;
  completed: boolean;
};

type BlockState = Omit<LoggerBlock, "sets"> & { sets: SetState[] };

const toState = (s: PrefillSet): SetState => ({
  reps: s.reps?.toString() ?? "",
  weight: s.weight?.toString() ?? "",
  weight_unit: s.weight_unit,
  duration_seconds: s.duration_seconds?.toString() ?? "",
  rpe: "",
  completed: false,
});

const numOrNull = (v: string) => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function RatingChips({
  name,
  label,
  value,
  onChange,
  labels,
}: {
  name: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  labels?: Record<number, string>;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === n}
              onChange={() => onChange(n)}
              onClick={() => value === n && onChange(null)}
            />
            <span className="inline-flex min-w-10 items-center justify-center rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 peer-checked:border-brand peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 dark:border-zinc-700 dark:text-zinc-400">
              {labels ? labels[n] : n}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WorkoutLogger({
  workoutId,
  initialBlocks,
  library,
  defaultDate,
  defaultUnit = "lb",
}: {
  workoutId: string | null;
  initialBlocks: LoggerBlock[];
  /** Exercises available to add (freestyle, or extras on a program day). */
  library: LoggerExercise[];
  defaultDate: string;
  defaultUnit?: "lb" | "kg";
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<BlockState[]>(() => initialBlocks.map((b) => ({ ...b, sets: b.sets.map(toState) })));
  const [performedOn, setPerformedOn] = useState(defaultDate);
  const [duration, setDuration] = useState("");
  const [sessionRpe, setSessionRpe] = useState("");
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [enjoyment, setEnjoyment] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [pain, setPain] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const doneCount = blocks.reduce((n, b) => n + b.sets.filter((s) => s.completed).length, 0);
  const totalCount = blocks.reduce((n, b) => n + b.sets.length, 0);

  const updateSet = (bi: number, si: number, patch: Partial<SetState>) =>
    setBlocks((bs) => bs.map((b, i) => (i === bi ? { ...b, sets: b.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : b)));

  const addSet = (bi: number) =>
    setBlocks((bs) =>
      bs.map((b, i) => {
        if (i !== bi) return b;
        const last = b.sets[b.sets.length - 1];
        return { ...b, sets: [...b.sets, last ? { ...last, completed: false, rpe: "" } : toState(buildPrefill({ sets: 1, reps: null, load: null }, [], defaultUnit)[0]!)] };
      }),
    );

  const removeSet = (bi: number) =>
    setBlocks((bs) => bs.map((b, i) => (i === bi && b.sets.length > 1 ? { ...b, sets: b.sets.slice(0, -1) } : b)));

  function addExercise(ex: LoggerExercise) {
    startTransition(async () => {
      const last = await lastPerformance(ex.id).catch(() => null);
      const prefill = buildPrefill({ sets: Math.max(3, last?.sets.length ?? 0), reps: null, load: null }, last?.sets ?? [], defaultUnit);
      setBlocks((bs) => [
        ...bs,
        {
          key: `${ex.id}-${Date.now()}`,
          workout_exercise_id: null,
          exercise: ex,
          prescription: null,
          lastTime: last ? { performed_on: longDateLabel(last.performed_on, { month: "short", day: "numeric" }), summary: summarizeSets(last.sets) } : null,
          sets: prefill.map(toState),
        },
      ]);
    });
  }

  function finish() {
    setError(null);
    if (doneCount === 0 && !window.confirm("No sets are ticked as done. Save the workout anyway?")) return;
    const sets = blocks.flatMap((b) =>
      b.sets.map((s, j) => ({
        exercise_id: b.exercise.id,
        workout_exercise_id: b.workout_exercise_id,
        set_number: j + 1,
        reps: numOrNull(s.reps) == null ? null : Math.round(numOrNull(s.reps)!),
        weight: numOrNull(s.weight),
        weight_unit: s.weight_unit,
        duration_seconds: numOrNull(s.duration_seconds) == null ? null : Math.round(numOrNull(s.duration_seconds)!),
        rpe: numOrNull(s.rpe),
        completed: s.completed,
      })),
    );
    startTransition(async () => {
      const res = await logWorkout({
        workout_id: workoutId,
        performed_on: performedOn,
        duration_minutes: numOrNull(duration) == null ? null : Math.round(numOrNull(duration)!),
        session_rpe: numOrNull(sessionRpe),
        difficulty_rating: difficulty,
        enjoyment_rating: enjoyment,
        energy_level: energy,
        pain_flag: pain,
        feedback: feedback.trim() || null,
        sets,
      });
      if (res.ok) router.push(`/me/plan?logged=${res.data.logId}`);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {blocks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Add the exercises you did below.
        </p>
      ) : null}

      {blocks.map((b, bi) => (
        <section key={b.key} aria-labelledby={`ex-${b.key}`} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id={`ex-${b.key}`} className="flex flex-wrap items-center gap-2 font-semibold">
                {b.prescription?.superset_label ? <Badge tone="purple">{b.prescription.superset_label}</Badge> : null}
                {b.exercise.name}
                {b.exercise.is_unilateral ? <span className="text-xs font-normal text-zinc-500">(each side)</span> : null}
              </h2>
              {b.prescription ? (
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {[
                    `${b.prescription.sets} × ${b.prescription.reps ?? "—"}`,
                    b.prescription.load,
                    b.prescription.rest_seconds ? `rest ${b.prescription.rest_seconds}s` : null,
                    b.prescription.tempo ? `tempo ${b.prescription.tempo}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {b.lastTime ? (
                <p className="mt-0.5 text-xs text-zinc-500">
                  Last time ({b.lastTime.performed_on}): {b.lastTime.summary}
                </p>
              ) : null}
            </div>
            {!b.workout_exercise_id ? (
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                onClick={() => setBlocks((bs) => bs.filter((_, i) => i !== bi))}
                aria-label={`Remove ${b.exercise.name}`}
              >
                Remove
              </button>
            ) : null}
          </div>
          {b.prescription?.notes ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{b.prescription.notes}</p> : null}

          {b.exercise.demo_video_url || b.exercise.coaching_cues.length || b.exercise.instructions ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-brand">Demo & coaching cues</summary>
              <div className="mt-2 flex flex-col gap-2">
                <VideoEmbed url={b.exercise.demo_video_url} title={`${b.exercise.name} demo`} />
                {b.exercise.coaching_cues.length ? (
                  <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                    {b.exercise.coaching_cues.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : null}
                {b.exercise.instructions ? <p className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">{b.exercise.instructions}</p> : null}
              </div>
            </details>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="w-10 pb-1 font-semibold">Set</th>
                  <th className="pb-1 font-semibold">Reps</th>
                  <th className="pb-1 font-semibold">Weight</th>
                  <th className="w-16 pb-1 font-semibold">RPE</th>
                  <th className="w-12 pb-1 text-center font-semibold">Done</th>
                </tr>
              </thead>
              <tbody>
                {b.sets.map((s, si) => (
                  <tr key={si} className={cn(s.completed && "bg-emerald-50/60 dark:bg-emerald-950/30")}>
                    <td className="py-1 pr-2 font-medium text-zinc-500">{si + 1}</td>
                    <td className="py-1 pr-2">
                      <Input className="h-9 w-16" type="number" inputMode="numeric" min={0} aria-label={`Set ${si + 1} reps`} value={s.reps} onChange={(e) => updateSet(bi, si, { reps: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex gap-1">
                        <Input className="h-9 w-20" type="number" inputMode="decimal" min={0} step="any" aria-label={`Set ${si + 1} weight`} value={s.weight} onChange={(e) => updateSet(bi, si, { weight: e.target.value })} />
                        <Select className="h-9 w-16 px-2" aria-label={`Set ${si + 1} unit`} value={s.weight_unit} onChange={(e) => updateSet(bi, si, { weight_unit: e.target.value as "lb" | "kg" })}>
                          <option value="lb">lb</option>
                          <option value="kg">kg</option>
                        </Select>
                      </div>
                    </td>
                    <td className="py-1 pr-2">
                      <Input className="h-9 w-16" type="number" inputMode="decimal" min={1} max={10} step="0.5" aria-label={`Set ${si + 1} RPE`} value={s.rpe} onChange={(e) => updateSet(bi, si, { rpe: e.target.value })} />
                    </td>
                    <td className="py-1 text-center">
                      <input type="checkbox" className="size-6 rounded accent-emerald-600" aria-label={`Set ${si + 1} done`} checked={s.completed} onChange={(e) => updateSet(bi, si, { completed: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => addSet(bi)}>
              + Set
            </Button>
            {b.sets.length > 1 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => removeSet(bi)}>
                − Set
              </Button>
            ) : null}
          </div>
        </section>
      ))}

      <AddExercise library={library} disabled={pending} onAdd={addExercise} title={workoutId ? "Add an extra exercise" : "Add exercise"} defaultOpen={!workoutId} />

      <section aria-labelledby="finish-h" className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 id="finish-h" className="font-semibold">Finish workout</h2>
        <p className="text-xs text-zinc-500">
          {doneCount} of {totalCount} sets done. Your coach sees how it went.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="performed_on">Date</Label>
            <Input id="performed_on" type="date" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duration">Duration (min)</Label>
            <Input id="duration" type="number" min={1} max={600} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="session_rpe">Session RPE (1-10)</Label>
            <Select id="session_rpe" value={sessionRpe} onChange={(e) => setSessionRpe(e.target.value)}>
              <option value="">–</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 1 ? " · very easy" : n === 5 ? " · moderate" : n === 8 ? " · hard" : n === 10 ? " · max effort" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          <RatingChips name="difficulty" label="How did it feel?" value={difficulty} onChange={setDifficulty} labels={DIFFICULTY_LABELS} />
          <div className="grid gap-4 sm:grid-cols-2">
            <RatingChips name="enjoyment" label="Enjoyment (1-5)" value={enjoyment} onChange={setEnjoyment} />
            <RatingChips name="energy" label="Energy (1-5)" value={energy} onChange={setEnergy} />
          </div>
          <Checkbox checked={pain} onChange={(e) => setPain(e.target.checked)} label="I felt pain (not just effort) during this workout" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feedback">Notes for your coach</Label>
            <Textarea
              id="feedback"
              value={feedback}
              maxLength={4000}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={pain ? "Where did it hurt, and during which exercise?" : "What went well? Anything that felt off?"}
            />
          </div>
        </div>
        {error ? (
          <div className="mt-4">
            <Alert tone="red">{error}</Alert>
          </div>
        ) : null}
        <div className="mt-4">
          <Button type="button" size="lg" onClick={finish} disabled={pending || (blocks.length === 0 && !feedback.trim())}>
            {pending ? "Saving…" : "Finish & save workout"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function AddExercise({
  library,
  disabled,
  onAdd,
  title,
  defaultOpen,
}: {
  library: LoggerExercise[];
  disabled: boolean;
  onAdd: (ex: LoggerExercise) => void;
  title: string;
  defaultOpen: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return library.filter((e) => (!category || e.category === category) && (!needle || e.name.toLowerCase().includes(needle))).slice(0, 30);
  }, [library, q, category]);
  if (library.length === 0) return null;
  return (
    <details open={defaultOpen} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px]">
        <Input type="search" aria-label="Search exercises" placeholder="Search exercises…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {EXERCISE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </Select>
      </div>
      {results.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No exercises match.</p>
      ) : (
        <ul className="mt-2 max-h-64 divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {results.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-sm">{e.name}</span>
              <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAdd(e)} aria-label={`Add ${e.name}`}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
