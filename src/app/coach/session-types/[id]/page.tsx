import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/scheduling/copy-button";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/env";
import { SessionTypeForm } from "../session-type-form";
import { deleteSessionTypeAction, updateSessionTypeAction } from "../actions";

export const metadata = { title: "Edit session type" };

export default async function EditSessionTypePage({ params }: PageProps<"/coach/session-types/[id]">) {
  const profile = await requireTrainer();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: st }, { data: store }] = await Promise.all([
    supabase.from("session_types").select("*").eq("id", id).eq("trainer_id", profile.id).maybeSingle(),
    supabase.from("trainer_profiles").select("slug").eq("trainer_id", profile.id).maybeSingle(),
  ]);
  if (!st) notFound();
  const link = store ? absoluteUrl(`/book/${store.slug}/${st.slug}`) : null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={st.name}
        description={link ?? undefined}
        actions={
          <>
            {link ? <CopyButton text={link} /> : null}
            <Link href="/coach/session-types" className="self-center text-sm font-medium text-brand hover:underline">
              ← Back
            </Link>
          </>
        }
      />
      <SessionTypeForm action={updateSessionTypeAction} sessionType={st} submitLabel="Save changes" />
      <Card className="mt-6">
        <CardTitle>Delete</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">Only session types without any bookings can be deleted. Otherwise, turn it off.</p>
        <ActionForm action={deleteSessionTypeAction} className="mt-3">
          <input type="hidden" name="id" value={st.id} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">
            Delete session type
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
