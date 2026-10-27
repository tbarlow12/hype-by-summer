"use client";

import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import type { ActionState } from "@/lib/actions";

/**
 * One-button form for a server action (with hidden fields). Shows the action's
 * error / success message above the button. Optional confirm prompt.
 */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel = "Working…",
  variant = "outline",
  size = "sm",
  confirm,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  confirm?: string;
}) {
  return (
    <ActionForm action={action}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span
        className="contents"
        onClickCapture={(e) => {
          if (confirm && (e.target as HTMLElement).closest("button[type=submit]") && !window.confirm(confirm)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
          {children}
        </SubmitButton>
      </span>
    </ActionForm>
  );
}
