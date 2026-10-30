import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/scheduling/copy-button";
import { requireManager } from "@/lib/auth";
import { businessUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { listCoaches } from "@/lib/scheduling/availability";
import { SessionTypeForm } from "../session-type-form";
import { deleteSessionTypeAction, updateSessionTypeAction } from "../actions";

export const metadata = { title: "Edit session type" };

export default async function EditSessionTypePage({ params }: PageProps<"/coach/session-types/[id]">) {
  const { business } = await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: st }, coaches] = await Promise.all([
    supabase.from("session_types").select("*").eq("id", id).eq("business_id", business.id).maybeSingle(),
    listCoaches(business.id),
  ]);
  if (!st) notFound();
  const link = businessUrl(business, `/book/${st.slug}`);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={st.name}
        description={link}
        actions={
          <>
            <CopyButton text={link} />
            <Link href="/coach/session-types" className="self-center text-sm font-medium text-brand hover:underline">
              ← Back
            </Link>
          </>
        }
      />
      <SessionTypeForm action={updateSessionTypeAction} sessionType={st} coaches={coaches} submitLabel="Save changes" />
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
