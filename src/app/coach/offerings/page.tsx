import Link from "next/link";
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/payments/action-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { priceLabel } from "@/lib/payments/format";
import { isOfferingSynced } from "@/lib/payments/offerings";
import { isStripeConfigured } from "@/lib/stripe";
import type { Tables } from "@/lib/supabase/database.types";
import { resyncOffering, setOfferingActive, syncAllOfferingsAction } from "./actions";

export const metadata = { title: "Packages & plans" };

type Offering = Tables<"offerings">;

const GROUPS: { kind: Offering["kind"]; title: string; description: string }[] = [
  { kind: "package", title: "Session packages", description: "One-time purchases that add session credits." },
  { kind: "subscription", title: "Memberships", description: "Recurring plans billed automatically." },
  { kind: "one_time", title: "One-off products", description: "Downloads and services." },
];

export default async function OfferingsPage({ searchParams }: PageProps<"/coach/offerings">) {
  const { business } = await requireManager();
  const { saved, sync } = await searchParams;
  const supabase = await createClient();
  const [{ data: offerings }, { data: sessionTypes }, { data: sold }] = await Promise.all([
    supabase.from("offerings").select("*").eq("business_id", business.id).order("sort_order").order("created_at"),
    supabase.from("session_types").select("id, name").eq("business_id", business.id),
    supabase.from("payments").select("offering_id").eq("business_id", business.id).eq("status", "succeeded").not("offering_id", "is", null),
  ]);
  const typeNames = new Map((sessionTypes ?? []).map((s) => [s.id, s.name]));
  const salesBy = new Map<string, number>();
  for (const p of sold ?? []) salesBy.set(p.offering_id!, (salesBy.get(p.offering_id!) ?? 0) + 1);
  const stripeReady = isStripeConfigured() && Boolean(business.stripe_account_id);
  const canSell = stripeReady && business.stripe_charges_enabled;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Packages & plans"
        description="Everything clients can buy: session packs, memberships and one-off products. Changes sync to Stripe automatically."
        actions={
          <>
            <LinkButton href="/pricing" variant="outline" target="_blank">
              View pricing page
            </LinkButton>
            <LinkButton href="/coach/offerings/new">New offering</LinkButton>
          </>
        }
      />

      {typeof saved === "string" ? (
        sync === "failed" ? (
          <Alert tone="amber">Saved “{saved}”, but syncing to Stripe failed. Use “Retry sync” below.</Alert>
        ) : (
          <Alert tone="green">Saved “{saved}”.</Alert>
        )
      ) : null}
      {!canSell ? (
        <Alert tone="amber">
          {stripeReady ? "Finish Stripe onboarding" : "Connect Stripe"} so clients can buy these online.{" "}
          <Link href="/coach/payments/setup" className="font-semibold underline">Payments setup</Link>
        </Alert>
      ) : null}
      {stripeReady && offerings?.some((o) => !isOfferingSynced(o)) ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Some offerings aren&apos;t synced to your Stripe account yet.</p>
          <ActionButton action={syncAllOfferingsAction} fields={{}} pendingLabel="Syncing…">Sync all</ActionButton>
        </div>
      ) : null}

      {!offerings?.length ? (
        <EmptyState
          title="Nothing for sale yet"
          description="Create a session pack, a monthly membership or a downloadable program. They'll appear on your public pricing page."
          action={<LinkButton href="/coach/offerings/new">Create your first offering</LinkButton>}
        />
      ) : (
        GROUPS.map((g) => {
          const items = offerings.filter((o) => o.kind === g.kind);
          return (
            <section key={g.kind} aria-labelledby={`group-${g.kind}`} className="flex flex-col gap-3">
              <div>
                <h2 id={`group-${g.kind}`} className="text-lg font-semibold tracking-tight">{g.title}</h2>
                <p className="text-sm text-zinc-500">{g.description}</p>
              </div>
              {items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
                  None yet.{" "}
                  <Link href="/coach/offerings/new" className="font-semibold text-brand">
                    Add one
                  </Link>
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((o) => {
                    const synced = isOfferingSynced(o);
                    return (
                      <Card key={o.id} className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold">
                              <Link href={`/coach/offerings/${o.id}`} className="hover:text-brand">
                                {o.name}
                              </Link>
                            </h3>
                            <p className="text-lg font-bold tracking-tight">{priceLabel(o)}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {o.active ? <Badge tone="green">Live</Badge> : <Badge>Hidden</Badge>}
                            {o.featured ? <Badge tone="brand">Featured</Badge> : null}
                            {o.stripe_sync_error ? (
                              <Badge tone="red" title={o.stripe_sync_error}>Stripe sync failed</Badge>
                            ) : synced ? (
                              <Badge tone="blue">Synced to Stripe</Badge>
                            ) : (
                              <Badge tone="amber">Not synced</Badge>
                            )}
                          </div>
                        </div>
                        <ul className="flex flex-col gap-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                          {o.credits > 0 ? (
                            <li>
                              {o.credits} credit{o.credits === 1 ? "" : "s"}
                              {o.kind === "subscription" ? " per period" : ""}
                              {o.credits_expire_days ? `, expire after ${o.credits_expire_days} days` : ""}
                              {o.session_type_ids?.length
                                ? ` · ${o.session_type_ids.map((id) => typeNames.get(id) ?? "Unknown").join(", ")}`
                                : " · any session type"}
                            </li>
                          ) : null}
                          {o.kind === "subscription" && o.trial_days > 0 ? <li>{o.trial_days}-day free trial</li> : null}
                          {o.kind === "one_time" ? <li>{o.digital_file_path ? `File: ${o.digital_file_name ?? o.digital_file_path.split("/").pop()}` : "Service (no file)"}</li> : null}
                          <li>{salesBy.get(o.id) ?? 0} sale{salesBy.get(o.id) === 1 ? "" : "s"}</li>
                          {o.stripe_synced_at ? (
                            <li className="text-xs text-zinc-500">Last synced {formatDateTime(o.stripe_synced_at, business.timezone)}</li>
                          ) : null}
                        </ul>
                        {o.stripe_sync_error ? <p className="text-xs text-red-600">{o.stripe_sync_error}</p> : null}
                        <div className="mt-auto flex flex-wrap gap-2">
                          <LinkButton href={`/coach/offerings/${o.id}`} variant="outline" size="sm">
                            Edit
                          </LinkButton>
                          <ActionButton action={setOfferingActive} fields={{ id: o.id, active: String(!o.active) }} variant="ghost">
                            {o.active ? "Hide" : "Make live"}
                          </ActionButton>
                          {!synced && stripeReady ? (
                            <ActionButton action={resyncOffering} fields={{ id: o.id }} variant="ghost" pendingLabel="Syncing…">
                              Retry sync
                            </ActionButton>
                          ) : null}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
