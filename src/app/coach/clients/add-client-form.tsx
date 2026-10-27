"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input, Textarea } from "@/components/ui";
import { addClient } from "./actions";

export function AddClientForm() {
  return (
    <ActionForm action={addClient} className="grid gap-4 sm:grid-cols-2">
      <Field label="Email" htmlFor="add-email" hint="New clients get an email invite; existing accounts are linked right away.">
        <Input id="add-email" name="email" type="email" required autoComplete="off" placeholder="client@example.com" />
      </Field>
      <Field label="Full name (optional)" htmlFor="add-name">
        <Input id="add-name" name="full_name" autoComplete="off" />
      </Field>
      <Field label="Tags (optional)" htmlFor="add-tags" hint="Comma separated, e.g. in-person, mornings">
        <Input id="add-tags" name="tags" autoComplete="off" />
      </Field>
      <Field label="Goals (optional)" htmlFor="add-goals" className="sm:col-span-2">
        <Textarea id="add-goals" name="goals" className="min-h-16" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Sending invite…">Add client</SubmitButton>
      </div>
    </ActionForm>
  );
}
