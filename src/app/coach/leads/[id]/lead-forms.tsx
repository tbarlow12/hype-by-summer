"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import {
  BUDGETS,
  EXPERIENCE_LEVELS,
  FORMATS,
  GOALS,
  LOST_REASONS,
  STATUS_LABELS,
  TIMELINES,
  type Option,
} from "@/lib/leads/options";
import type { Tables } from "@/lib/supabase/database.types";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

function Options({ options, empty = "—" }: { options: Option[]; empty?: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );
}

const DAYS: Option[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];
const TIMES: Option[] = [
  { value: "early_morning", label: "Early morning" },
  { value: "morning", label: "Morning" },
  { value: "midday", label: "Midday" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

export function LeadDetailsForm({ action, lead }: { action: Action; lead: Tables<"leads"> }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="First name" htmlFor="ld-first">
        <Input id="ld-first" name="first_name" defaultValue={lead.first_name ?? ""} maxLength={100} />
      </Field>
      <Field label="Last name" htmlFor="ld-last">
        <Input id="ld-last" name="last_name" defaultValue={lead.last_name ?? ""} maxLength={100} />
      </Field>
      <Field label="Phone" htmlFor="ld-phone">
        <Input id="ld-phone" name="phone" type="tel" defaultValue={lead.phone ?? ""} maxLength={40} />
      </Field>
      <Field label="Primary goal" htmlFor="ld-goal">
        <Select id="ld-goal" name="primary_goal" defaultValue={lead.primary_goal ?? ""}>
          <Options options={GOALS} />
        </Select>
      </Field>
      <Field label="Goal details / message" htmlFor="ld-goal-details" className="sm:col-span-2">
        <Textarea id="ld-goal-details" name="goal_details" defaultValue={lead.goal_details ?? ""} rows={3} maxLength={5000} />
      </Field>
      <Field label="Experience" htmlFor="ld-exp">
        <Select id="ld-exp" name="experience_level" defaultValue={lead.experience_level ?? ""}>
          <Options options={EXPERIENCE_LEVELS} />
        </Select>
      </Field>
      <Field label="Preferred format" htmlFor="ld-format">
        <Select id="ld-format" name="preferred_format" defaultValue={lead.preferred_format ?? ""}>
          <Options options={FORMATS} />
        </Select>
      </Field>
      <Field label="Budget" htmlFor="ld-budget">
        <Select id="ld-budget" name="budget_range" defaultValue={lead.budget_range ?? ""}>
          <Options options={BUDGETS} />
        </Select>
      </Field>
      <Field label="Timeline" htmlFor="ld-timeline">
        <Select id="ld-timeline" name="timeline" defaultValue={lead.timeline ?? ""}>
          <Options options={TIMELINES} />
        </Select>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Preferred days</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <Checkbox key={d.value} name="preferred_days[]" value={d.value} label={d.label} defaultChecked={lead.preferred_days.includes(d.value)} />
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Preferred times</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {TIMES.map((t) => (
            <Checkbox key={t.value} name="preferred_times[]" value={t.value} label={t.label} defaultChecked={lead.preferred_times.includes(t.value)} />
          ))}
        </div>
      </fieldset>
      <Field label="City" htmlFor="ld-city">
        <Input id="ld-city" name="city" defaultValue={lead.city ?? ""} maxLength={100} />
      </Field>
      <Field label="ZIP" htmlFor="ld-zip">
        <Input id="ld-zip" name="zip_code" defaultValue={lead.zip_code ?? ""} maxLength={20} />
      </Field>
      <Field label="Injuries or limitations" htmlFor="ld-injuries" className="sm:col-span-2">
        <Textarea id="ld-injuries" name="injuries_or_limitations" defaultValue={lead.injuries_or_limitations ?? ""} rows={2} maxLength={2000} className="min-h-0" />
      </Field>
      <Field label="How they heard about you" htmlFor="ld-heard">
        <Input id="ld-heard" name="how_heard" defaultValue={lead.how_heard ?? ""} maxLength={200} />
      </Field>
      <Field label="Tags" htmlFor="ld-tags" hint="Comma separated">
        <Input id="ld-tags" name="tags" defaultValue={lead.tags.join(", ")} />
      </Field>
      <Field label="Private notes" htmlFor="ld-notes" className="sm:col-span-2">
        <Textarea id="ld-notes" name="notes" defaultValue={lead.notes ?? ""} rows={3} maxLength={10000} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save details</SubmitButton>
      </div>
    </ActionForm>
  );
}

const OPEN = ["new", "contacted", "consult_booked", "nurturing", "converted"] as const;

export function StatusForm({ action, status }: { action: Action; status: string }) {
  return (
    <ActionForm action={action} className="flex gap-2">
      <label htmlFor="ls-status" className="sr-only">
        Status
      </label>
      <Select id="ls-status" name="status" defaultValue={OPEN.includes(status as (typeof OPEN)[number]) ? status : ""} className="flex-1">
        {OPEN.includes(status as (typeof OPEN)[number]) ? null : <option value="">{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status} (reopen as…)</option>}
        {OPEN.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" pendingLabel="…">
        Update
      </SubmitButton>
    </ActionForm>
  );
}

/** Managers pick anyone (or nobody); others get only the options they're allowed (claim / release). */
export function AssignForm({ action, value, options }: { action: Action; value: string | null; options: { value: string; label: string }[] }) {
  return (
    <ActionForm action={action} className="flex gap-2">
      <label htmlFor="la-coach" className="sr-only">
        Assigned to
      </label>
      <Select id="la-coach" name="assigned_coach_id" defaultValue={value ?? ""} className="min-w-0 flex-1">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" pendingLabel="…">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

export function FollowUpForm({ action, value }: { action: Action; value: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap gap-2">
      <label htmlFor="lf-at" className="sr-only">
        Next follow-up
      </label>
      <Input id="lf-at" name="next_follow_up_at" type="datetime-local" defaultValue={value} className="min-w-0 flex-1" />
      <SubmitButton variant="secondary" pendingLabel="…">
        Set
      </SubmitButton>
    </ActionForm>
  );
}

export function LostForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      <label htmlFor="ll-reason" className="sr-only">
        Reason
      </label>
      <Select id="ll-reason" name="lost_reason" required defaultValue="">
        <option value="" disabled>
          Why was it lost?
        </option>
        {LOST_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <Input name="lost_note" placeholder="Details (optional)" maxLength={2000} aria-label="Details" />
      <SubmitButton variant="outline" pendingLabel="Saving…">
        Mark as lost
      </SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-2">
      <label htmlFor="ln-text" className="sr-only">
        Note
      </label>
      <Textarea id="ln-text" name="text" rows={2} placeholder="Add a note (call summary, next steps…)" maxLength={5000} required />
      <div>
        <SubmitButton size="sm" pendingLabel="Adding…">
          Add note
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EmailForm({ action, firstName, signature }: { action: Action; firstName: string | null; signature: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-3">
      <Field label="Subject" htmlFor="le-subject">
        <Input id="le-subject" name="subject" required maxLength={200} defaultValue="Quick question about your goals" />
      </Field>
      <Field label="Message" htmlFor="le-body" hint="Blank lines start a new paragraph. Replies go to your email.">
        <Textarea
          id="le-body"
          name="body"
          rows={7}
          required
          maxLength={10000}
          defaultValue={`Hi ${firstName ?? "there"},\n\n\n\n${signature}`}
        />
      </Field>
      <div>
        <SubmitButton pendingLabel="Sending…">Send email</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function InviteForm({ action, label }: { action: Action; label: string }) {
  return (
    <ActionForm action={action}>
      <SubmitButton className="w-full" pendingLabel="Inviting…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function DeleteLeadForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <Checkbox name="confirm" label="I understand this permanently deletes the lead and its history." required />
      <div>
        <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">
          Delete lead
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
