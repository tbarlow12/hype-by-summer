"use client";

import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Button, Card, Checkbox, Field, Input, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import type { Slot } from "@/lib/scheduling/slots";
import { PAYMENT_LABELS, type PaymentChoice } from "@/lib/scheduling/policy";
import { SlotPicker } from "./slot-picker";

export type BookingViewer = {
  name: string | null;
  email: string;
  phone: string | null;
  smsOptIn: boolean;
} | null;

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export const SMS_CONSENT_LABEL =
  "Text me reminders about this session (msg & data rates may apply, reply STOP to opt out)";

export function BookingFlow({
  trainerSlug,
  sessionSlug,
  sessionName,
  priceLabel,
  fallbackTimezone,
  initialMonth,
  minMonth,
  viewer,
  paymentOptions,
  creditBalance,
  creditsRequired,
  policyText,
  isGroup,
  bookAction,
  waitlistAction,
}: {
  trainerSlug: string;
  sessionSlug: string;
  sessionName: string;
  priceLabel: string;
  fallbackTimezone: string;
  initialMonth: string;
  minMonth?: string;
  viewer: BookingViewer;
  paymentOptions: PaymentChoice[];
  creditBalance: number | null;
  creditsRequired: number;
  policyText: string;
  isGroup: boolean;
  bookAction: Action;
  waitlistAction: Action;
}) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [tz, setTz] = useState(fallbackTimezone);
  const [phone, setPhone] = useState(viewer?.phone ?? "");
  const [payment, setPayment] = useState<PaymentChoice>(paymentOptions[0] ?? "stripe");
  const full = slot !== null && slot.spotsLeft === 0;

  const submitLabel =
    payment === "stripe" ? `Continue to payment · ${priceLabel}` : payment === "credits" ? "Book with credits" : "Confirm booking";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">1. Pick a time</h2>
        <SlotPicker
          trainerSlug={trainerSlug}
          sessionSlug={sessionSlug}
          fallbackTimezone={fallbackTimezone}
          initialMonth={initialMonth}
          minMonth={minMonth}
          selected={slot}
          showFull={isGroup}
          onSelect={(s, zone) => {
            setSlot(s);
            setTz(zone);
          }}
        />
      </Card>

      {slot ? (
        <Card id="details">
          <h2 className="text-lg font-semibold">2. {full ? "Join the waitlist" : "Your details"}</h2>
          <p className="mb-4 mt-1 text-sm text-zinc-500">
            {sessionName} · {formatInTimeZone(slot.start, tz, "EEEE, MMMM d 'at' h:mm a")} ({tz.replace(/_/g, " ")})
          </p>

          {full ? (
            <ActionForm action={waitlistAction} className="flex flex-col gap-4" key={`wl-${slot.start}`}>
              <Alert tone="amber">This class is full. Join the waitlist and we&apos;ll email you if a spot opens up.</Alert>
              <input type="hidden" name="trainer" value={trainerSlug} />
              <input type="hidden" name="session" value={sessionSlug} />
              <input type="hidden" name="starts_at" value={slot.start} />
              {viewer ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">We&apos;ll notify {viewer.email}.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor="wl-name">
                    <Input id="wl-name" name="name" autoComplete="name" required />
                  </Field>
                  <Field label="Email" htmlFor="wl-email">
                    <Input id="wl-email" name="email" type="email" autoComplete="email" required />
                  </Field>
                </div>
              )}
              <SubmitButton pendingLabel="Joining…">Join waitlist</SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={bookAction} className="flex flex-col gap-4" key={`bk-${slot.start}`}>
              <input type="hidden" name="trainer" value={trainerSlug} />
              <input type="hidden" name="session" value={sessionSlug} />
              <input type="hidden" name="starts_at" value={slot.start} />
              <input type="hidden" name="timezone" value={tz} />
              {viewer ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Booking as <span className="font-medium text-zinc-900 dark:text-zinc-100">{viewer.name ?? viewer.email}</span> ({viewer.email})
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="bk-name">
                    <Input id="bk-name" name="name" autoComplete="name" required />
                  </Field>
                  <Field label="Email" htmlFor="bk-email">
                    <Input id="bk-email" name="email" type="email" autoComplete="email" required />
                  </Field>
                </div>
              )}
              <Field label="Phone (optional)" htmlFor="bk-phone">
                <Input
                  id="bk-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              {phone.trim() ? <Checkbox name="sms_opt_in" label={SMS_CONSENT_LABEL} defaultChecked={viewer?.smsOptIn ?? false} /> : null}
              <Field label="Anything your coach should know? (optional)" htmlFor="bk-notes">
                <Textarea id="bk-notes" name="notes" maxLength={2000} placeholder="Goals, injuries, questions…" />
              </Field>

              {paymentOptions.length > 1 ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Payment</legend>
                  {paymentOptions.map((p) => (
                    <label
                      key={p}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/5 dark:border-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <input type="radio" name="payment" value={p} checked={payment === p} onChange={() => setPayment(p)} className="accent-brand" />
                        {PAYMENT_LABELS[p]}
                      </span>
                      <span className="text-zinc-500">
                        {p === "credits" ? `${creditsRequired} of ${creditBalance ?? 0} credits` : p === "stripe" ? priceLabel : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <>
                  <input type="hidden" name="payment" value={payment} />
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {payment === "free" ? "No payment needed." : payment === "pay_later" ? `${priceLabel}, paid at the session.` : `${priceLabel}, paid securely by card on the next step. Your spot is held for 30 minutes.`}
                  </p>
                </>
              )}

              <p className="text-xs text-zinc-500">{policyText}</p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton pendingLabel="Booking…" size="lg">
                  {submitLabel}
                </SubmitButton>
                <Button type="button" variant="ghost" size="lg" onClick={() => setSlot(null)}>
                  Change time
                </Button>
              </div>
            </ActionForm>
          )}
        </Card>
      ) : null}
    </div>
  );
}
