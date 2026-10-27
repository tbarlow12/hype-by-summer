"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </Button>
  );
}
