import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { listCoaches } from "@/lib/scheduling/availability";
import { SessionTypeForm } from "../session-type-form";
import { createSessionTypeAction } from "../actions";

export const metadata = { title: "New session type" };

export default async function NewSessionTypePage() {
  const { profile, business } = await requireManager();
  const coaches = await listCoaches(business.id);
  const bookable = coaches.filter((c) => c.isBookable).map((c) => c.id);
  return (
    <div className="max-w-2xl">
      <PageHeader title="New session type" actions={<Link href="/coach/session-types" className="text-sm font-medium text-brand hover:underline">← Back</Link>} />
      <SessionTypeForm
        action={createSessionTypeAction}
        coaches={coaches}
        // Solo businesses: the owner. Teams: everyone bookable, adjust as needed.
        defaultCoachIds={bookable.length ? bookable : [profile.id]}
        submitLabel="Create session type"
      />
    </div>
  );
}
