import type { Enums } from "@/lib/supabase/database.types";

export const RELATIONSHIP_STATUSES = ["active", "paused", "archived"] as const;

export const statusTone = (s: Enums<"relationship_status">) =>
  s === "active" ? ("green" as const) : s === "paused" ? ("amber" as const) : s === "invited" ? ("blue" as const) : ("neutral" as const);

export const subscriptionTone = (status: string) =>
  status === "active" || status === "trialing"
    ? ("green" as const)
    : ["past_due", "unpaid", "incomplete"].includes(status)
      ? ("red" as const)
      : ("neutral" as const);
