"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { buttonClass, Field, Input } from "@/components/ui";
import { setPassword } from "@/components/account/password-actions";

export function ResetPasswordForm() {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <p className="text-sm">Your password is saved.</p>
        <Link href="/auth/continue" className={buttonClass("primary")}>
          Continue
        </Link>
      </div>
    );
  }
  return (
    <ActionForm action={setPassword} className="flex flex-col gap-4" onSuccess={() => setDone(true)}>
      <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
        <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <Field label="Confirm password" htmlFor="confirm-password">
        <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      <SubmitButton>Save password</SubmitButton>
    </ActionForm>
  );
}
