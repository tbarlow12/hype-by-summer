"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

/** Submit button that asks for confirmation first. */
export function ConfirmSubmit({
  children,
  confirm,
  variant = "outline",
  size = "sm",
  pendingLabel = "Working…",
  className,
}: {
  children: ReactNode;
  confirm: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
