"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { submitContactForm } from "@/app/(marketing)/actions";
import { consentText, FORMATS, GOALS, TIMELINES } from "@/lib/leads/options";

/** Homepage contact form: creates a lead (source contact_form) with the message. */
export function ContactForm({ brandName }: { brandName: string }) {
  const id = useId();
  const f = (name: string) => `${id}-${name}`;
  return (
    <ActionForm action={submitContactForm} resetOnSuccess className="flex flex-col gap-4">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={f("website")}>Website</label>
        <input id={f("website")} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={f("name")}>
          <Input id={f("name")} name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Email" htmlFor={f("email")}>
          <Input id={f("email")} name="email" type="email" autoComplete="email" required maxLength={320} />
        </Field>
        <Field label="Phone (optional)" htmlFor={f("phone")}>
          <Input id={f("phone")} name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </Field>
        <Field label="Main goal" htmlFor={f("primary_goal")}>
          <Select id={f("primary_goal")} name="primary_goal" defaultValue="">
            <option value="">Choose one…</option>
            {GOALS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Preferred format" htmlFor={f("preferred_format")}>
          <Select id={f("preferred_format")} name="preferred_format" defaultValue="">
            <option value="">No preference</option>
            {FORMATS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="When do you want to start?" htmlFor={f("timeline")}>
          <Select id={f("timeline")} name="timeline" defaultValue="">
            <option value="">Select…</option>
            {TIMELINES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Message" htmlFor={f("message")}>
        <Textarea
          id={f("message")}
          name="message"
          required
          maxLength={5000}
          rows={5}
          placeholder="Tell me a little about where you're at and what you'd like help with."
        />
      </Field>
      <Checkbox name="marketing_consent" label={consentText(brandName)} />
      <SubmitButton size="lg" pendingLabel="Sending…" className="w-full sm:w-auto sm:self-start">
        Send message
      </SubmitButton>
    </ActionForm>
  );
}
