import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { BookingFlow } from "@/components/scheduling/booking-flow";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { creditBalance, listBookableSessionTypes } from "@/lib/scheduling/availability";
import { bookingFlowProps } from "@/lib/scheduling/flow";
import { locationSummary, priceLabel } from "@/lib/scheduling/labels";
import { createBookingAction, joinWaitlistAction } from "@/app/book/actions";

export const metadata = { title: "Book a session" };

export default async function ClientBookPage({ searchParams }: PageProps<"/me/book">) {
  const profile = await requireClient();
  const { session, date } = await searchParams;
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) {
    return (
      <>
        <PageHeader title="Book a session" />
        <EmptyState title="You're not connected to a coach yet" description="Once your coach adds you, you can book sessions here." />
      </>
    );
  }
  const { data: storefront } = await createAdminClient().from("trainer_profiles").select("slug, default_location").eq("trainer_id", trainerId).maybeSingle();
  const types = await listBookableSessionTypes(trainerId, { includeClientsOnly: true });
  const selected = typeof session === "string" ? types.find((t) => t.slug === session) : undefined;

  if (selected && storefront) {
    const flow = await bookingFlowProps({
      trainerId,
      trainerSlug: storefront.slug,
      sessionType: selected,
      client: profile,
      focus: typeof date === "string" ? date : undefined,
    });
    return (
      <>
        <PageHeader
          title={selected.name}
          description={`${formatDuration(selected.duration_minutes)} · ${locationSummary(selected, storefront.default_location)} · ${priceLabel(selected)}`}
          actions={<Link href="/me/book" className="text-sm font-medium text-brand hover:underline">← All session types</Link>}
        />
        <BookingFlow {...flow} bookAction={createBookingAction} waitlistAction={joinWaitlistAction} />
      </>
    );
  }

  const balances = await Promise.all(types.map((t) => (t.allow_credits ? creditBalance(profile.id, trainerId, t.id) : Promise.resolve(0))));
  return (
    <>
      <PageHeader title="Book a session" description="Pick a session type to see open times." />
      {types.length === 0 ? (
        <EmptyState title="No session types available" description="Your coach hasn't opened any sessions for booking yet." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {types.map((st, i) => (
            <li key={st.id}>
              <Link href={`/me/book?session=${st.slug}`} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                <Card className="flex h-full flex-col gap-2 transition-colors hover:border-brand/50">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold">{st.name}</h2>
                    <span className="font-semibold">{priceLabel(st)}</span>
                  </div>
                  {st.description ? <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{st.description}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    <Badge>{formatDuration(st.duration_minutes)}</Badge>
                    <Badge>{locationSummary(st, storefront?.default_location)}</Badge>
                    {st.capacity > 1 ? <Badge tone="purple">Group · up to {st.capacity}</Badge> : null}
                    {st.clients_only ? <Badge tone="brand">Clients only</Badge> : null}
                    {balances[i]! >= st.credits_required && st.allow_credits && st.credits_required > 0 && !st.is_consultation ? (
                      <Badge tone="green">{balances[i]} credits available</Badge>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
