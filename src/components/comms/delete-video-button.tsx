"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteVideoSubmission } from "@/lib/comms/video-actions";

export function DeleteVideoButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this video? Your coach won't be able to review it.")) return;
        start(async () => {
          const res = await deleteVideoSubmission({ id });
          if (res.ok) router.push("/me/videos");
          else window.alert(res.error);
        });
      }}
    >
      {pending ? "Deleting…" : "Delete video"}
    </Button>
  );
}
