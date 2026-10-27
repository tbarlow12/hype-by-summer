"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, Checkbox, Input } from "@/components/ui";
import type { ActionState } from "@/lib/actions";

export type RangeValue = { key: string; weekday: number; start: string; end: string; types: string[] };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

let counter = 0;
const nextKey = () => `r${++counter}`;

export function WeeklyHoursEditor({
  initial,
  sessionTypes,
  action,
}: {
  initial: Omit<RangeValue, "key">[];
  sessionTypes: { id: string; name: string }[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [ranges, setRanges] = useState<RangeValue[]>(() => initial.map((r, i) => ({ ...r, key: `i${i}` })));

  const update = (key: string, patch: Partial<RangeValue>) => setRanges((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRanges((rs) => rs.filter((r) => r.key !== key));
  const add = (weekday: number) => {
    const existing = ranges.filter((r) => r.weekday === weekday).sort((a, b) => a.end.localeCompare(b.end));
    const last = existing.at(-1);
    const start = last ? last.end : "09:00";
    const startH = Number(start.slice(0, 2));
    const end = startH >= 23 ? "24:00" : `${String(Math.min(startH + 2, 23)).padStart(2, "0")}:${start.slice(3)}`;
    setRanges((rs) => [...rs, { key: nextKey(), weekday, start, end, types: [] }]);
  };
  const copyToWeekdays = (weekday: number) => {
    const source = ranges.filter((r) => r.weekday === weekday);
    setRanges((rs) => [
      ...rs.filter((r) => r.weekday === weekday || r.weekday === 0 || r.weekday === 6),
      ...[1, 2, 3, 4, 5].filter((d) => d !== weekday).flatMap((d) => source.map((r) => ({ ...r, weekday: d, key: nextKey() }))),
    ]);
  };

  const payload = JSON.stringify(ranges.map(({ weekday, start, end, types }) => ({ weekday, start, end, types })));

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <input type="hidden" name="rules" value={payload} />
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {ORDER.map((weekday) => {
          const dayRanges = ranges.filter((r) => r.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
          return (
            <li key={weekday} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="w-28 shrink-0 pt-2 text-sm font-semibold">{DAYS[weekday]}</div>
              <div className="flex flex-1 flex-col gap-2">
                {dayRanges.length === 0 ? <p className="pt-2 text-sm text-zinc-400">Unavailable</p> : null}
                {dayRanges.map((r) => (
                  <div key={r.key} className="flex flex-col gap-2 rounded-xl sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label={`${DAYS[weekday]} start`}
                        value={r.start}
                        onChange={(e) => update(r.key, { start: e.target.value })}
                        className="w-32"
                        required
                      />
                      <span className="text-zinc-400">–</span>
                      <Input
                        type="time"
                        aria-label={`${DAYS[weekday]} end`}
                        value={r.end === "24:00" ? "23:59" : r.end}
                        onChange={(e) => update(r.key, { end: e.target.value === "23:59" ? "24:00" : e.target.value })}
                        className="w-32"
                        required
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.key)} aria-label="Remove range">
                        ✕
                      </Button>
                    </div>
                    {sessionTypes.length > 1 ? (
                      <details className="text-xs text-zinc-500">
                        <summary className="cursor-pointer">
                          {r.types.length ? `Only: ${sessionTypes.filter((s) => r.types.includes(s.id)).map((s) => s.name).join(", ")}` : "All session types"}
                        </summary>
                        <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                          {sessionTypes.map((s) => (
                            <Checkbox
                              key={s.id}
                              label={s.name}
                              checked={r.types.includes(s.id)}
                              onChange={(e) =>
                                update(r.key, { types: e.target.checked ? [...r.types, s.id] : r.types.filter((t) => t !== s.id) })
                              }
                            />
                          ))}
                          <p className="text-[11px]">Leave all unticked to allow every session type.</p>
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => add(weekday)}>
                    + Add hours
                  </Button>
                  {dayRanges.length && weekday >= 1 && weekday <= 5 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyToWeekdays(weekday)}>
                      Copy to Mon–Fri
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div>
        <SubmitButton>Save weekly hours</SubmitButton>
      </div>
    </ActionForm>
  );
}
