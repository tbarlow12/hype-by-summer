import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { SessionTypeForm } from "../session-type-form";
import { createSessionTypeAction } from "../actions";

export const metadata = { title: "New session type" };

export default async function NewSessionTypePage() {
  await requireTrainer();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New session type" actions={<Link href="/coach/session-types" className="text-sm font-medium text-brand hover:underline">← Back</Link>} />
      <SessionTypeForm action={createSessionTypeAction} submitLabel="Create session type" />
    </div>
  );
}
