"use client";

import { useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { signup } from "../actions";

/** Name/email/password signup. On success the form is replaced by "check your email". */
export function SignupForm({
  next,
  email,
  askPhone = true,
  submitLabel = "Create account",
}: {
  next?: string;
  email?: string;
  askPhone?: boolean;
  submitLabel?: string;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  // React resets the form after the action runs, so remember the address as it's typed.
  const typed = useRef(email ?? "");
  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
        <span aria-hidden className="text-3xl">✉️</span>
        <p className="font-semibold">Check your email</p>
        <p className="text-sm text-zinc-500">
          We sent a link to <span className="font-medium text-zinc-700 dark:text-zinc-300">{sentTo}</span>. Open it on this
          device to continue.
        </p>
        <button type="button" onClick={() => setSentTo(null)} className="mt-2 text-sm text-zinc-500 underline underline-offset-4">
          Use a different email
        </button>
      </div>
    );
  }
  return (
    <ActionForm
      action={signup}
      className="flex flex-col gap-4"
      onSuccess={() => setSentTo(typed.current || "your inbox")}
    >
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="signup-email">
        <Input id="signup-email" name="email" type="email" autoComplete="email" defaultValue={email ?? ""}
          onChange={(e) => {
            typed.current = e.target.value;
          }}
          required
        />
      </Field>
      {askPhone ? (
        <Field label="Phone (optional)" htmlFor="phone" hint="For session reminders by text.">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        </Field>
      ) : null}
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
      </Field>
      <SubmitButton pendingLabel="Creating account…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
