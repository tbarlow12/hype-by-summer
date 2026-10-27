"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { GOALS, LEAD_SOURCES, SOURCE_LABELS } from "@/lib/leads/options";
import { createLeadManually } from "./actions";

export function QuickAddLead() {
  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>+ Add a lead</span>
        <span className="text-xs font-normal text-zinc-500 group-open:hidden">Met someone at the gym? Add them here.</span>
      </summary>
      <ActionForm action={createLeadManually} className="grid gap-4 border-t border-zinc-200 p-5 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800">
        <Field label="First name" htmlFor="ql-first">
          <Input id="ql-first" name="first_name" required maxLength={100} />
        </Field>
        <Field label="Last name" htmlFor="ql-last">
          <Input id="ql-last" name="last_name" maxLength={100} />
        </Field>
        <Field label="Email" htmlFor="ql-email">
          <Input id="ql-email" name="email" type="email" required />
        </Field>
        <Field label="Phone" htmlFor="ql-phone">
          <Input id="ql-phone" name="phone" type="tel" maxLength={40} />
        </Field>
        <Field label="Source" htmlFor="ql-source">
          <Select id="ql-source" name="source" defaultValue="manual">
            {LEAD_SOURCES.filter((s) => s !== "lead_magnet" && s !== "booking").map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Goal" htmlFor="ql-goal">
          <Select id="ql-goal" name="primary_goal" defaultValue="">
            <option value="">Unknown</option>
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How they heard about you" htmlFor="ql-heard" className="sm:col-span-2">
          <Input id="ql-heard" name="how_heard" maxLength={200} placeholder="e.g. referred by Jess, gym floor" />
        </Field>
        <Field label="Note" htmlFor="ql-note" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="ql-note" name="note" rows={2} maxLength={5000} className="min-h-0" />
        </Field>
        <div className="flex items-end">
          <SubmitButton pendingLabel="Adding…" className="w-full">
            Add lead
          </SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
