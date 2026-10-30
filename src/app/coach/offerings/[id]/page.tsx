import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { OfferingForm } from "@/components/payments/offering-form";
import { ActionButton } from "@/components/payments/action-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isOfferingSynced } from "@/lib/payments/offerings";
import { deleteOffering, resyncOffering, saveOffering } from "../actions";

export const metadata = { title: "Edit offering" };

export default async function EditOfferingPage({ params }: PageProps<"/coach/offerings/[id]">) {
  const { business } = await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: offering }, { data: sessionTypes }] = await Promise.all([
    supabase.from("offerings").select("*").eq("id", id).eq("business_id", business.id).maybeSingle(),
    supabase.from("session_types").select("id, name").eq("business_id", business.id).order("sort_order"),
  ]);
  if (!offering) notFound();
  const synced = isOfferingSynced(offering);

  return (
    <div className="max-w-2xl">
      <p className="mb-2 text-sm">
        <Link href="/coach/offerings" className="text-zinc-500 hover:text-brand">
          ← Packages & plans
        </Link>
      </p>
      <PageHeader
        title={offering.name}
        description="Changing the price or billing interval creates a new Stripe price; existing members keep their current price."
      />
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Stripe</span>
            {offering.stripe_sync_error ? (
              <Badge tone="red">Sync failed</Badge>
            ) : synced ? (
              <Badge tone="blue">Synced</Badge>
            ) : (
              <Badge tone="amber">Not synced</Badge>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Product {offering.stripe_product_id ?? "–"} · Price {offering.stripe_price_id ?? "–"}
          </p>
          {offering.stripe_sync_error ? <p className="text-xs text-red-600">{offering.stripe_sync_error}</p> : null}
        </div>
        <ActionButton action={resyncOffering} fields={{ id: offering.id }} pendingLabel="Syncing…">
          Sync now
        </ActionButton>
      </Card>
      <Card>
        <OfferingForm action={saveOffering} offering={offering} sessionTypes={sessionTypes ?? []} businessId={business.id} />
      </Card>
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Delete offering</p>
          <p className="text-sm text-zinc-500">Only possible before anyone has bought it. Otherwise, hide it.</p>
        </div>
        <ActionButton
          action={deleteOffering}
          fields={{ id: offering.id }}
          variant="danger"
          pendingLabel="Deleting…"
          confirm="Delete this offering? This can't be undone."
        >
          Delete
        </ActionButton>
      </Card>
    </div>
  );
}
