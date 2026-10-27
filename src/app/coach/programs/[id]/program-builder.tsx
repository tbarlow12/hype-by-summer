"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, Badge, Button, Checkbox, Input, Label, Select, Textarea, cn } from "@/components/ui";
import type { ExerciseLite, WorkoutExerciseRow, WorkoutRow } from "@/lib/training/server";
import { EXERCISE_CATEGORIES } from "@/lib/training/constants";
import { programWorkoutDate, shortDayLabel } from "@/lib/training/dates";
import { titleCase } from "@/lib/format";
import {
  addExerciseToWorkout,
  addWorkout,
  copyWeek,
  deleteWorkout,
  duplicateWorkout,
  removeWorkoutExercise,
  reorderWorkoutExercises,
  reorderWorkouts,
  updateWorkout,
  updateWorkoutExercise,
  type Result,
} from "../actions";

type Props = {
  programId: string;
  durationWeeks: number;
  startDate: string | null;
  initialWorkouts: WorkoutRow[];
  library: ExerciseLite[];
};

const DAYS = [1, 2, 3, 4, 5, 6, 7];

function supersetLabels(exercises: WorkoutExerciseRow[]): Map<string, string> {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const e of exercises) {
    if (!e.superset_group) continue;
    const n = (counts.get(e.superset_group) ?? 0) + 1;
    counts.set(e.superset_group, n);
    labels.set(e.id, `${e.superset_group}${n}`);
  }
  return labels;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function ProgramBuilder({ programId, durationWeeks, startDate, initialWorkouts, library }: Props) {
  const [workouts, setWorkouts] = useState<WorkoutRow[]>(initialWorkouts);
  const [week, setWeek] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copyOpen, setCopyOpen] = useState(false);

  const selected = workouts.find((w) => w.id === selectedId) ?? null;
  const weeks = Array.from({ length: durationWeeks }, (_, i) => i + 1);

  /** Apply a change locally right away, roll back if the server refuses. */
  function mutate(apply: (ws: WorkoutRow[]) => WorkoutRow[], call: () => Promise<Result<unknown>>) {
    const snapshot = workouts;
    setError(null);
    setNotice(null);
    setWorkouts(apply);
    startTransition(async () => {
      const res = await call();
      if (!res.ok) {
        setWorkouts(snapshot);
        setError(res.error);
      }
    });
  }

  /** Wait for the server (new ids), then merge. */
  function run<T>(call: () => Promise<Result<T>>, onOk: (data: T) => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await call();
      if (res.ok) onOk(res.data);
      else setError(res.error);
    });
  }

  const patchWorkout = (id: string, patch: Partial<WorkoutRow>) =>
    mutate(
      (ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      () => updateWorkout(id, patch as Parameters<typeof updateWorkout>[1]),
    );

  const dayWorkouts = (wk: number, d: number) =>
    workouts.filter((w) => w.week === wk && w.day === d).sort((a, b) => a.sort_order - b.sort_order);

  function moveWithinDay(w: WorkoutRow, dir: -1 | 1) {
    const list = dayWorkouts(w.week, w.day);
    const i = list.findIndex((x) => x.id === w.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ordered = move(list, i, j);
    const order = new Map(ordered.map((x, idx) => [x.id, idx]));
    mutate(
      (ws) => ws.map((x) => (order.has(x.id) ? { ...x, sort_order: order.get(x.id)! } : x)),
      () => reorderWorkouts(programId, ordered.map((x) => x.id)),
    );
  }

  function addToDay(d: number) {
    run(
      () => addWorkout(programId, week, d, "New workout"),
      (row) => {
        setWorkouts((ws) => [...ws, row]);
        setSelectedId(row.id);
      },
    );
  }

  const weekCount = (wk: number) => workouts.filter((w) => w.week === wk).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Program weeks" className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
          {weeks.map((wk) => (
            <button
              key={wk}
              role="tab"
              type="button"
              aria-selected={wk === week}
              onClick={() => {
                setWeek(wk);
                setCopyOpen(false);
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                wk === week ? "bg-white text-brand shadow-sm dark:bg-zinc-800" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              Week {wk}
              <span className="ml-1 text-xs text-zinc-400">{weekCount(wk)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {pending ? <span className="text-xs text-zinc-500" role="status">Saving…</span> : null}
          {durationWeeks > 1 ? (
            <Button variant="outline" size="sm" onClick={() => setCopyOpen((o) => !o)} aria-expanded={copyOpen}>
              Copy week {week} to…
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <Alert tone="red">{error}</Alert> : null}
      {notice ? <Alert tone="green">{notice}</Alert> : null}

      {copyOpen ? (
        <CopyWeekPanel
          key={week}
          fromWeek={week}
          weeks={weeks}
          disabled={pending}
          onCancel={() => setCopyOpen(false)}
          onApply={(targets, replace) =>
            run(
              () => copyWeek(programId, week, targets, replace),
              (rows) => {
                setWorkouts(rows);
                setCopyOpen(false);
                setSelectedId(null);
                setNotice(`Week ${week} copied to week${targets.length > 1 ? "s" : ""} ${targets.join(", ")}.`);
              },
            )
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {DAYS.map((d) => {
          const list = dayWorkouts(week, d);
          return (
            <section key={d} aria-label={`Week ${week} day ${d}`} className="flex min-h-32 flex-col gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
              <header className="flex items-baseline justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Day {d}</span>
                {startDate ? <span className="text-[11px] text-zinc-400">{shortDayLabel(programWorkoutDate(startDate, week, d))}</span> : null}
              </header>
              {list.length === 0 ? <p className="px-1 text-xs text-zinc-400">Rest day</p> : null}
              {list.map((w, i) => (
                <div
                  key={w.id}
                  className={cn(
                    "group rounded-xl border bg-white p-2 text-left shadow-sm transition-colors dark:bg-zinc-900",
                    w.id === selectedId ? "border-brand ring-2 ring-brand/20" : "border-zinc-200 hover:border-brand/50 dark:border-zinc-800",
                  )}
                >
                  <button type="button" onClick={() => setSelectedId(w.id === selectedId ? null : w.id)} className="block w-full text-left" aria-pressed={w.id === selectedId}>
                    <span className="block truncate text-sm font-semibold">{w.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {w.exercises.length} exercise{w.exercises.length === 1 ? "" : "s"}
                      {w.estimated_minutes ? ` · ${w.estimated_minutes} min` : ""}
                    </span>
                  </button>
                  {list.length > 1 ? (
                    <div className="mt-1 flex gap-1">
                      <button type="button" className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === 0} onClick={() => moveWithinDay(w, -1)} aria-label={`Move ${w.name} up`}>
                        ↑
                      </button>
                      <button type="button" className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === list.length - 1} onClick={() => moveWithinDay(w, 1)} aria-label={`Move ${w.name} down`}>
                        ↓
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addToDay(d)}
                disabled={pending}
                className="mt-auto rounded-xl border border-dashed border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-brand hover:text-brand disabled:opacity-50 dark:border-zinc-700"
              >
                + Add workout
              </button>
            </section>
          );
        })}
      </div>

      {selected ? (
        <WorkoutEditor
          key={selected.id}
          workout={selected}
          weeks={weeks}
          library={library}
          pending={pending}
          onClose={() => setSelectedId(null)}
          onPatch={(patch) => {
            if (patch.week !== undefined || patch.day !== undefined) {
              const wk = patch.week ?? selected.week;
              const d = patch.day ?? selected.day;
              const sort = dayWorkouts(wk, d).length;
              patchWorkout(selected.id, { ...patch, sort_order: sort });
              if (wk !== week) setWeek(wk);
            } else {
              patchWorkout(selected.id, patch);
            }
          }}
          onDelete={() => {
            mutate(
              (ws) => ws.filter((w) => w.id !== selected.id),
              () => deleteWorkout(selected.id),
            );
            setSelectedId(null);
          }}
          onDuplicate={(wk, d) =>
            run(
              () => duplicateWorkout(selected.id, wk, d),
              (row) => {
                setWorkouts((ws) => [...ws, row]);
                setNotice(`Copied “${selected.name}” to week ${wk}, day ${d}.`);
              },
            )
          }
          onExercisesChange={(apply, call) =>
            mutate((ws) => ws.map((w) => (w.id === selected.id ? { ...w, exercises: apply(w.exercises) } : w)), call)
          }
          onAddExercise={(exerciseId) =>
            run(
              () => addExerciseToWorkout(selected.id, exerciseId),
              (row) =>
                setWorkouts((ws) => ws.map((w) => (w.id === selected.id ? { ...w, exercises: [...w.exercises, row] } : w))),
            )
          }
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Select a workout to edit its exercises, or add one to any day.
        </p>
      )}
    </div>
  );
}

function CopyWeekPanel({
  fromWeek,
  weeks,
  disabled,
  onApply,
  onCancel,
}: {
  fromWeek: number;
  weeks: number[];
  disabled: boolean;
  onApply: (targets: number[], replace: boolean) => void;
  onCancel: () => void;
}) {
  const others = weeks.filter((w) => w !== fromWeek);
  const [targets, setTargets] = useState<number[]>(others.filter((w) => w > fromWeek));
  const [replace, setReplace] = useState(true);
  const toggle = (w: number) => setTargets((t) => (t.includes(w) ? t.filter((x) => x !== w) : [...t, w].sort((a, b) => a - b)));
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <fieldset>
        <legend className="text-sm font-semibold">Copy week {fromWeek} to</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {others.map((w) => (
            <label key={w} className="cursor-pointer">
              <input type="checkbox" className="peer sr-only" checked={targets.includes(w)} onChange={() => toggle(w)} />
              <span className="inline-flex rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 dark:border-zinc-700 dark:text-zinc-400">
                Week {w}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="text-xs font-medium text-brand" onClick={() => setTargets(others.filter((w) => w > fromWeek))}>
          All later weeks
        </button>
        <button type="button" className="text-xs font-medium text-zinc-500" onClick={() => setTargets([])}>
          None
        </button>
      </div>
      <Checkbox className="mt-3" checked={replace} onChange={(e) => setReplace(e.target.checked)} label="Replace workouts already in those weeks" />
      <div className="mt-4 flex gap-2">
        <Button size="sm" disabled={disabled || targets.length === 0} onClick={() => onApply(targets, replace)}>
          Copy to {targets.length} week{targets.length === 1 ? "" : "s"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function intOrNull(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function WorkoutEditor({
  workout,
  weeks,
  library,
  pending,
  onClose,
  onPatch,
  onDelete,
  onDuplicate,
  onExercisesChange,
  onAddExercise,
}: {
  workout: WorkoutRow;
  weeks: number[];
  library: ExerciseLite[];
  pending: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Pick<WorkoutRow, "name" | "notes" | "estimated_minutes" | "week" | "day">>) => void;
  onDelete: () => void;
  onDuplicate: (week: number, day: number) => void;
  onExercisesChange: (apply: (list: WorkoutExerciseRow[]) => WorkoutExerciseRow[], call: () => Promise<Result<unknown>>) => void;
  onAddExercise: (exerciseId: string) => void;
}) {
  const [dupWeek, setDupWeek] = useState(Math.min(workout.week + 1, weeks.length));
  const [dupDay, setDupDay] = useState(workout.day);
  const labels = supersetLabels(workout.exercises);
  const list = workout.exercises;

  const patchExercise = (id: string, patch: Partial<WorkoutExerciseRow>) =>
    onExercisesChange(
      (l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      () => updateWorkoutExercise(id, patch as Parameters<typeof updateWorkoutExercise>[1]),
    );

  const reorder = (i: number, j: number) => {
    if (j < 0 || j >= list.length) return;
    const ordered = move(list, i, j).map((e, idx) => ({ ...e, sort_order: idx }));
    onExercisesChange(() => ordered, () => reorderWorkoutExercises(workout.id, ordered.map((e) => e.id)));
  };

  return (
    <section aria-label={`Edit ${workout.name}`} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_140px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-name">Workout name</Label>
            <Input
              id="w-name"
              defaultValue={workout.name}
              maxLength={120}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== workout.name) onPatch({ name: v });
                else e.target.value = workout.name;
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-min">Est. minutes</Label>
            <Input
              id="w-min"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              defaultValue={workout.estimated_minutes ?? ""}
              onBlur={(e) => {
                const v = intOrNull(e.target.value);
                if (v !== workout.estimated_minutes) onPatch({ estimated_minutes: v });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="w-notes">Notes for the client</Label>
            <Textarea
              id="w-notes"
              className="min-h-16"
              defaultValue={workout.notes ?? ""}
              maxLength={4000}
              placeholder="Warm-up, intent for the day, how hard to push…"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== workout.notes) onPatch({ notes: v });
              }}
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close editor">
          Close
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-week" className="text-xs">Move to week</Label>
            <Select id="w-week" className="h-9 w-28" value={workout.week} onChange={(e) => onPatch({ week: Number(e.target.value) })}>
              {weeks.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-day" className="text-xs">Day</Label>
            <Select id="w-day" className="h-9 w-24" value={workout.day} onChange={(e) => onPatch({ day: Number(e.target.value) })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>Day {d}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="d-week" className="text-xs">Duplicate to</Label>
            <Select id="d-week" className="h-9 w-28" value={dupWeek} onChange={(e) => setDupWeek(Number(e.target.value))}>
              {weeks.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </Select>
          </div>
          <Select aria-label="Duplicate to day" className="h-9 w-24" value={dupDay} onChange={(e) => setDupDay(Number(e.target.value))}>
            {DAYS.map((d) => (
              <option key={d} value={d}>Day {d}</option>
            ))}
          </Select>
          <Button variant="outline" size="sm" className="h-9" disabled={pending} onClick={() => onDuplicate(dupWeek, dupDay)}>
            Duplicate
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-9 text-red-600 dark:text-red-400"
          onClick={() => {
            if (window.confirm(`Delete “${workout.name}” and its exercises?`)) onDelete();
          }}
        >
          Delete workout
        </Button>
      </div>

      <h3 className="mt-6 text-sm font-semibold">Exercises</h3>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No exercises yet. Add some from your library below.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {list.map((e, i) => (
            <li key={e.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                {labels.get(e.id) ? <Badge tone="purple">{labels.get(e.id)}</Badge> : <span className="w-6 text-center text-xs text-zinc-400">{i + 1}</span>}
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{e.exercise.name}</p>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === 0} onClick={() => reorder(i, i - 1)} aria-label={`Move ${e.exercise.name} up`}>
                    ↑
                  </button>
                  <button type="button" className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" disabled={i === list.length - 1} onClick={() => reorder(i, i + 1)} aria-label={`Move ${e.exercise.name} down`}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    onClick={() => onExercisesChange((l) => l.filter((x) => x.id !== e.id), () => removeWorkoutExercise(e.id))}
                    aria-label={`Remove ${e.exercise.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <PrescriptionInput label="Sets" type="number" value={e.sets} onSave={(v) => { const n = intOrNull(v); if (n && n !== e.sets) patchExercise(e.id, { sets: n }); }} />
                <PrescriptionInput label="Reps" value={e.reps} placeholder="8-10" onSave={(v) => v !== (e.reps ?? "") && patchExercise(e.id, { reps: v || null })} />
                <PrescriptionInput label="Load" value={e.load} placeholder="RPE 8" onSave={(v) => v !== (e.load ?? "") && patchExercise(e.id, { load: v || null })} />
                <PrescriptionInput label="Rest (s)" type="number" value={e.rest_seconds} onSave={(v) => { const n = intOrNull(v); if (n !== e.rest_seconds) patchExercise(e.id, { rest_seconds: n }); }} />
                <PrescriptionInput label="Tempo" value={e.tempo} placeholder="3-1-1-0" onSave={(v) => v !== (e.tempo ?? "") && patchExercise(e.id, { tempo: v || null })} />
                <PrescriptionInput label="Superset" value={e.superset_group} placeholder="A" maxLength={4} onSave={(v) => v.toUpperCase() !== (e.superset_group ?? "") && patchExercise(e.id, { superset_group: v ? v.toUpperCase() : null })} />
              </div>
              <PrescriptionInput label="Notes" value={e.notes} className="mt-2" placeholder="Pause at the bottom, last set to failure…" onSave={(v) => v !== (e.notes ?? "") && patchExercise(e.id, { notes: v || null })} />
            </li>
          ))}
        </ol>
      )}

      <ExercisePicker library={library} disabled={pending} onPick={onAddExercise} />
    </section>
  );
}

function PrescriptionInput({
  label,
  value,
  onSave,
  type = "text",
  placeholder,
  maxLength,
  className,
}: {
  label: string;
  value: string | number | null;
  onSave: (v: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <Input
        className="h-9"
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        min={type === "number" ? 0 : undefined}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        maxLength={maxLength}
        onBlur={(e) => onSave(e.target.value.trim())}
      />
    </label>
  );
}

function ExercisePicker({ library, disabled, onPick }: { library: ExerciseLite[]; disabled: boolean; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return library
      .filter((e) => (!category || e.category === category) && (!needle || e.name.toLowerCase().includes(needle) || e.primary_muscles.some((m) => m.includes(needle)) || e.equipment.some((m) => m.includes(needle))))
      .slice(0, 40);
  }, [library, q, category]);

  return (
    <div className="mt-5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
      <p className="text-sm font-semibold">Add exercise</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px]">
        <Input type="search" aria-label="Search exercises" placeholder="Search by name, muscle or equipment…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {EXERCISE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </Select>
      </div>
      {results.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No matching exercises. Create one in the exercise library.</p>
      ) : (
        <ul className="mt-2 max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {results.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {e.name} {e.trainer_id ? <Badge tone="brand" className="ml-1">Mine</Badge> : null}
                </p>
                <p className="truncate text-xs text-zinc-500">{[e.category && titleCase(e.category), ...e.primary_muscles.map(titleCase)].filter(Boolean).join(" · ")}</p>
              </div>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => onPick(e.id)} aria-label={`Add ${e.name}`}>
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
