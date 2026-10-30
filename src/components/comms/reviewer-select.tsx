"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import { assignVideoReviewer } from "@/lib/comms/video-actions";

/** Staff: pick which coach reviews a form check. */
export function ReviewerSelect({
  submissionId,
  value,
  team,
  viewerId,
}: {
  submissionId: string;
  value: string | null;
  team: { id: string; name: string }[];
  viewerId: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`reviewer-${submissionId}`} className="text-xs font-medium text-zinc-500">
        Reviewer
      </label>
      <Select
        id={`reviewer-${submissionId}`}
        value={current}
        disabled={pending}
        className="w-52"
        onChange={(e) => {
          const next = e.target.value;
          const before = current;
          setCurrent(next);
          setError(null);
          start(async () => {
            const res = await assignVideoReviewer({ id: submissionId, coachId: next || null });
            if (!res.ok) {
              setCurrent(before);
              setError(res.error);
            } else router.refresh();
          });
        }}
      >
        <option value="">Unassigned</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id === viewerId ? `${m.name} (me)` : m.name}
          </option>
        ))}
      </Select>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
