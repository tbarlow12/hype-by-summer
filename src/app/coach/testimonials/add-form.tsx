"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { addTestimonial } from "./actions";

export function AddTestimonialForm() {
  return (
    <ActionForm action={addTestimonial} resetOnSuccess className="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <Field label="Name to display" htmlFor="t-name">
        <Input id="t-name" name="author_name" required maxLength={80} placeholder="Jess M." />
      </Field>
      <Field label="Rating" htmlFor="t-rating">
        <Select id="t-rating" name="rating" defaultValue="5">
          <option value="">None</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Review" htmlFor="t-body" className="sm:col-span-2">
        <Textarea id="t-body" name="body" required maxLength={2000} rows={3} placeholder="Paste a review from Google, a text or an email (with permission)." />
      </Field>
      <Checkbox name="approved" defaultChecked label="Show on the website right away" className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Adding…">Add testimonial</SubmitButton>
      </div>
    </ActionForm>
  );
}
