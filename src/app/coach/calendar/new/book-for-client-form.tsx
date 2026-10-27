"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import { SMS_CONSENT_LABEL } from "@/components/scheduling/booking-flow";

type ClientOption = { id: string; name: string; phone: string | null; smsOptIn: boolean; credits: number };
type TypeOption = { id: string; name: string; creditsRequired: number; free: boolean };

export function BookForClientForm({
  clients,
  sessionTypes,
  defaultClientId,
  today,
  action,
}: {
  clients: ClientOption[];
  sessionTypes: TypeOption[];
  defaultClientId?: string;
  today: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const client = clients.find((c) => c.id === clientId);
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [typeId, setTypeId] = useState(sessionTypes[0]?.id ?? "");
  const type = sessionTypes.find((t) => t.id === typeId);
  const [weeks, setWeeks] = useState(1);

  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" htmlFor="client_id">
          <Select
            id="client_id"
            name="client_id"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPhone(clients.find((c) => c.id === e.target.value)?.phone ?? "");
            }}
            required
          >
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Session type" htmlFor="session_type_id">
          <Select id="session_type_id" name="session_type_id" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            {sessionTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="date">
          <Input id="date" name="date" type="date" min={today} defaultValue={today} required />
        </Field>
        <Field label="Start time (your timezone)" htmlFor="time">
          <Input id="time" name="time" type="time" defaultValue="09:00" required />
        </Field>
        <Field label="Repeat weekly for" htmlFor="weeks" hint={weeks > 1 ? `${weeks} sessions, same time each week` : "Just this once"}>
          <Select id="weeks" name="weeks" value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 8, 10, 12, 16, 24].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Don't repeat" : `${n} weeks`}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Payment"
          htmlFor="payment"
          hint={client && type && !type.free ? `${client.name} has ${client.credits} credit${client.credits === 1 ? "" : "s"}; ${type.creditsRequired * weeks} needed.` : undefined}
        >
          <Select id="payment" name="payment" defaultValue={type?.free ? "free" : "pay_later"} key={typeId}>
            <option value="pay_later">Pay later</option>
            <option value="credits">Use credits</option>
            <option value="free">Free</option>
          </Select>
        </Field>
      </div>
      <Field label="Client phone (optional)" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {phone.trim() ? <Checkbox name="sms_opt_in" key={clientId} defaultChecked={client?.smsOptIn ?? false} label={SMS_CONSENT_LABEL} /> : null}
      <Field label="Notes (visible to the client)" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={2000} />
      </Field>
      <p className="text-xs text-zinc-500">Bookings skip your availability hours but never double-book or overlap time off. Conflicting weeks are skipped and listed.</p>
      <div>
        <SubmitButton pendingLabel="Booking…">{weeks > 1 ? `Book ${weeks} sessions` : "Book session"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
