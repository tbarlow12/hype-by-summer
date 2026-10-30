"use client";

import { useState, useTransition } from "react";
import { Alert, cn } from "@/components/ui";
import { currentStreak, countInWeek } from "@/lib/training/habits";
import { shortDayLabel } from "@/lib/training/dates";
import { toggleHabitDay } from "./actions";

export type HabitGridItem = {
  id: string;
  name: string;
  target_per_week: number;
  byCoach: boolean;
  logged: string[];
};

/** This week's tick-boxes for each habit, with optimistic toggling and streaks. */
export function HabitGrid({ habits, days, today }: { habits: HabitGridItem[]; days: string[]; today: string }) {
  const [state, setState] = useState(habits);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(habitId: string, date: string) {
    const habit = state.find((h) => h.id === habitId)!;
    const done = !habit.logged.includes(date);
    const snapshot = state;
    setError(null);
    setState((hs) =>
      hs.map((h) => (h.id === habitId ? { ...h, logged: done ? [...h.logged, date] : h.logged.filter((d) => d !== date) } : h)),
    );
    startTransition(async () => {
      const res = await toggleHabitDay(habitId, date, done);
      if (!res.ok) {
        setState(snapshot);
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="red">{error}</Alert> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs text-zinc-500">
              <th scope="col" className="pb-2 text-left font-medium">Habit</th>
              {days.map((d) => (
                <th key={d} scope="col" className={cn("pb-2 text-center font-medium", d === today && "text-brand")}>
                  {shortDayLabel(d)}
                </th>
              ))}
              <th scope="col" className="pb-2 text-right font-medium">Week</th>
              <th scope="col" className="pb-2 text-right font-medium">Streak</th>
            </tr>
          </thead>
          <tbody>
            {state.map((h) => {
              const week = countInWeek(h.logged, days[0]!);
              const streak = currentStreak(h.logged, today);
              return (
                <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {h.name}
                    {h.byCoach ? <span className="ml-1 text-[11px] font-normal text-brand">from coach</span> : null}
                    <span className="block text-xs font-normal text-zinc-500">{h.target_per_week}× per week</span>
                  </th>
                  {days.map((d) => {
                    const checked = h.logged.includes(d);
                    const future = d > today;
                    return (
                      <td key={d} className="py-2 text-center">
                        <button
                          type="button"
                          disabled={future}
                          onClick={() => toggle(h.id, d)}
                          aria-pressed={checked}
                          aria-label={`${h.name} on ${shortDayLabel(d)}`}
                          className={cn(
                            "inline-flex size-8 items-center justify-center rounded-full border text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                            checked ? "border-brand bg-brand text-on-brand" : "border-zinc-300 text-transparent hover:border-brand dark:border-zinc-700",
                          )}
                        >
                          ✓
                        </button>
                      </td>
                    );
                  })}
                  <td className={cn("py-2 text-right tabular-nums", week >= h.target_per_week ? "font-semibold text-emerald-600" : "text-zinc-500")}>
                    {week}/{h.target_per_week}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">{streak ? `${streak}d` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
