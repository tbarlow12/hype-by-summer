"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { login } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  return (
    <ActionForm action={login} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <input type="hidden" name="mode" value={mode} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      {mode === "password" ? (
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <SubmitButton pendingLabel="Signing in…">
        {mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </SubmitButton>
      <button
        type="button"
        onClick={() => setMode(mode === "password" ? "magic" : "password")}
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
      </button>
    </ActionForm>
  );
}
