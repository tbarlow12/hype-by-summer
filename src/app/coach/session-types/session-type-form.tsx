import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardTitle, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import type { Tables } from "@/lib/supabase/database.types";
import { LOCATION_LABELS } from "@/lib/scheduling/labels";

type SessionType = Tables<"session_types">;

const DEFAULTS = {
  name: "",
  slug: "",
  description: null,
  duration_minutes: 60,
  price_cents: 0,
  location_type: "in_person",
  location_details: null,
  capacity: 1,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  min_notice_minutes: 720,
  max_advance_days: 60,
  slot_interval_minutes: 30,
  credits_required: 1,
  allow_credits: true,
  requires_payment: true,
  is_consultation: false,
  clients_only: false,
  active: true,
  color: "#e11d48",
  sort_order: 0,
} satisfies Partial<SessionType>;

export function SessionTypeForm({
  action,
  sessionType,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  sessionType?: SessionType;
  submitLabel: string;
}) {
  const v = sessionType ?? DEFAULTS;
  return (
    <ActionForm action={action} className="flex flex-col gap-6">
      {sessionType ? <input type="hidden" name="id" value={sessionType.id} /> : null}
      <Card className="flex flex-col gap-4">
        <CardTitle>Basics</CardTitle>
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={v.name} required maxLength={120} />
        </Field>
        <Field label="Link" htmlFor="slug" hint="Used in your booking URL: /book/your-name/<this>">
          <Input id="slug" name="slug" defaultValue={v.slug} required pattern="[a-z0-9][a-z0-9\-]{0,60}" />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" defaultValue={v.description ?? ""} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Duration (minutes)" htmlFor="duration_minutes">
            <Input id="duration_minutes" name="duration_minutes" type="number" min={5} max={600} step={5} defaultValue={v.duration_minutes} required />
          </Field>
          <Field label="Price (USD)" htmlFor="price" hint="0 = free">
            <Input id="price" name="price" type="number" min={0} step="0.01" defaultValue={(v.price_cents / 100).toFixed(2)} required />
          </Field>
          <Field label="Capacity" htmlFor="capacity" hint="More than 1 = group class">
            <Input id="capacity" name="capacity" type="number" min={1} max={500} defaultValue={v.capacity} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location" htmlFor="location_type">
            <Select id="location_type" name="location_type" defaultValue={v.location_type}>
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location details" htmlFor="location_details" hint="Address, phone instructions… (video links are created automatically)">
            <Input id="location_details" name="location_details" defaultValue={v.location_details ?? ""} maxLength={300} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Calendar color" htmlFor="color">
            <Input id="color" name="color" type="color" defaultValue={v.color} className="p-1" />
          </Field>
          <Field label="Sort order" htmlFor="sort_order" hint="Lower numbers show first">
            <Input id="sort_order" name="sort_order" type="number" defaultValue={v.sort_order} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Scheduling rules</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Buffer before (minutes)" htmlFor="buffer_before_minutes">
            <Input id="buffer_before_minutes" name="buffer_before_minutes" type="number" min={0} max={240} defaultValue={v.buffer_before_minutes} />
          </Field>
          <Field label="Buffer after (minutes)" htmlFor="buffer_after_minutes">
            <Input id="buffer_after_minutes" name="buffer_after_minutes" type="number" min={0} max={240} defaultValue={v.buffer_after_minutes} />
          </Field>
          <Field label="Minimum notice (hours)" htmlFor="min_notice_hours" hint="How soon before a session it can be booked">
            <Input id="min_notice_hours" name="min_notice_hours" type="number" min={0} step="0.25" defaultValue={v.min_notice_minutes / 60} />
          </Field>
          <Field label="Book up to (days ahead)" htmlFor="max_advance_days">
            <Input id="max_advance_days" name="max_advance_days" type="number" min={1} max={730} defaultValue={v.max_advance_days} />
          </Field>
          <Field label="Start times every (minutes)" htmlFor="slot_interval_minutes">
            <Select id="slot_interval_minutes" name="slot_interval_minutes" defaultValue={String(v.slot_interval_minutes)}>
              {[...new Set([10, 15, 20, 30, 45, 60, 90, 120, v.slot_interval_minutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Payment & visibility</CardTitle>
        <Field label="Credits per booking" htmlFor="credits_required">
          <Input id="credits_required" name="credits_required" type="number" min={0} max={50} defaultValue={v.credits_required} className="max-w-32" />
        </Field>
        <Checkbox name="allow_credits" defaultChecked={v.allow_credits} label="Clients can pay with session credits (packages / memberships)" />
        <Checkbox name="requires_payment" defaultChecked={v.requires_payment} label="Require payment when booking (otherwise clients pay at the session)" />
        <Checkbox name="is_consultation" defaultChecked={v.is_consultation} label="Free consultation (no payment; guests become leads)" />
        <Checkbox name="clients_only" defaultChecked={v.clients_only} label="Clients only (hidden from your public booking page)" />
        <Checkbox name="active" defaultChecked={v.active} label="Active (bookable)" />
      </Card>

      <div>
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
