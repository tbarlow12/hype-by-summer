"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { addClient } from "./actions";

export function AddClientForm({ coaches, defaultCoachId }: { coaches: { id: string; name: string }[]; defaultCoachId?: string }) {
  return (
    <ActionForm action={addClient} className="grid gap-4 sm:grid-cols-2">
      <Field label="Email" htmlFor="add-email" hint="We create their account if they don't have one yet.">
        <Input id="add-email" name="email" type="email" required autoComplete="off" placeholder="client@example.com" />
      </Field>
      <Field label="Full name (optional)" htmlFor="add-name">
        <Input id="add-name" name="full_name" autoComplete="off" />
      </Field>
      <Field label="Primary coach" htmlFor="add-coach">
        <Select id="add-coach" name="primary_coach_id" defaultValue={defaultCoachId ?? ""}>
          <option value="">Unassigned</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tags (optional)" htmlFor="add-tags" hint="Comma separated, e.g. in-person, mornings">
        <Input id="add-tags" name="tags" autoComplete="off" />
      </Field>
      <Field label="Goals (optional)" htmlFor="add-goals" className="sm:col-span-2">
        <Textarea id="add-goals" name="goals" className="min-h-16" />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox name="send_invite" defaultChecked label="Email them a sign-in link to their client app" />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Adding…">Add client</SubmitButton>
      </div>
    </ActionForm>
  );
}
