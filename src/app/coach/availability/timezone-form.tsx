"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Select } from "@/components/ui";
import type { ActionState } from "@/lib/actions";

export function TimezoneForm({
  coachId,
  value,
  label = "Your timezone",
  action,
}: {
  coachId: string;
  value: string;
  label?: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
}) {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [value];
  }
  if (!zones.includes(value)) zones = [value, ...zones];
  return (
    <ActionForm action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="coach_id" value={coachId} />
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="timezone" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        <Select id="timezone" name="timezone" defaultValue={value}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton variant="outline">Save timezone</SubmitButton>
    </ActionForm>
  );
}
