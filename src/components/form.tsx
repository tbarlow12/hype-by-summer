"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button } from "@/components/ui";
import type { ActionState } from "@/lib/actions";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant,
  size,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size} className={className}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * A <form> wired to a server action returning ActionState. Shows the error /
 * success message and optionally resets on success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {state.error ? <div className="mb-3"><Alert tone="red">{state.error}</Alert></div> : null}
      {state.ok && state.message ? <div className="mb-3"><Alert tone="green">{state.message}</Alert></div> : null}
      {children}
    </form>
  );
}
