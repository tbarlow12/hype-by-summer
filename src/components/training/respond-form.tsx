"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";

/** Inline coach reply box. Collapsed to a button until opened. */
export function RespondForm({
  action,
  existing,
  label = "Reply",
  placeholder = "Write a reply…",
  defaultOpen = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  existing?: string | null;
  label?: string;
  placeholder?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {existing ? "Edit reply" : label}
      </Button>
    );
  }
  return (
    <ActionForm action={action} className="flex flex-col gap-2" onSuccess={() => setOpen(defaultOpen)}>
      <Textarea name="response" defaultValue={existing ?? ""} placeholder={placeholder} rows={3} maxLength={4000} required aria-label={label} />
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Sending…">
          {existing ? "Update reply" : "Send reply"}
        </SubmitButton>
        {!defaultOpen ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </ActionForm>
  );
}
