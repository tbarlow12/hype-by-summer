"use client";

import { useId, useState } from "react";
import { Button, Input } from "@/components/ui";

/** Read-only input with a copy-to-clipboard button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="flex gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input id={id} value={value} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}
