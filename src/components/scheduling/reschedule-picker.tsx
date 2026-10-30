"use client";

import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/actions";
import type { TeamSlot } from "@/lib/scheduling/slots";
import { SlotPicker } from "./slot-picker";

export function ReschedulePicker({
  sessionSlug,
  coach,
  fallbackTimezone,
  initialMonth,
  manageToken,
  hidden,
  action,
}: {
  sessionSlug: string;
  /** The booking's coach (clients reschedule with the same coach). */
  coach: string;
  fallbackTimezone: string;
  initialMonth: string;
  manageToken: string;
  /** Extra hidden fields for the action (e.g. booking id). */
  hidden: Record<string, string>;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [slot, setSlot] = useState<TeamSlot | null>(null);
  const [tz, setTz] = useState(fallbackTimezone);
  return (
    <div className="flex flex-col gap-4">
      <SlotPicker
        sessionSlug={sessionSlug}
        coach={coach}
        fallbackTimezone={fallbackTimezone}
        initialMonth={initialMonth}
        rescheduleToken={manageToken}
        selected={slot}
        onSelect={(s, zone) => {
          setSlot(s);
          setTz(zone);
        }}
      />
      {slot ? (
        <ActionForm action={action} className="flex flex-wrap items-center gap-3" key={slot.start}>
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="starts_at" value={slot.start} />
          <p className="text-sm">
            New time: <span className="font-semibold">{formatInTimeZone(slot.start, tz, "EEE, MMM d 'at' h:mm a")}</span>
          </p>
          <SubmitButton pendingLabel="Rescheduling…">Confirm new time</SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
