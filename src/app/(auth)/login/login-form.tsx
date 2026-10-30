"use client";

import Link from "next/link";
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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-zinc-500 underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
      ) : null}
      <SubmitButton pendingLabel={mode === "password" ? "Signing in…" : "Sending…"}>
        {mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </SubmitButton>
      <button
        type="button"
        onClick={() => setMode(mode === "password" ? "magic" : "password")}
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        {mode === "password" ? "Email me a sign-in link instead" : "Use a password instead"}
      </button>
    </ActionForm>
  );
}
