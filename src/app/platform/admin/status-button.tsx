"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions";
import { setBusinessStatus } from "./actions";

export function StatusButton({ id, name, status }: { id: string; name: string; status: string }) {
  const [state, action, pending] = useActionState(setBusinessStatus, { ok: false } as ActionState);
  const suspend = status !== "suspended";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (suspend && !confirm(`Suspend ${name}? Their site and client app go offline until you reactivate them.`)) e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="business_id" value={id} />
      <input type="hidden" name="status" value={suspend ? "suspended" : "active"} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
          suspend
            ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
        }`}
      >
        {pending ? "…" : suspend ? "Suspend" : "Reactivate"}
      </button>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
    </form>
  );
}
