import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { BookingFlow } from "@/components/scheduling/booking-flow";
import { formatDuration } from "@/lib/format";
import { coachesForType, getBookableSessionType } from "@/lib/scheduling/availability";
import { bookingFlowProps } from "@/lib/scheduling/flow";
import { locationSummary, priceLabel } from "@/lib/scheduling/labels";
import { publicBookingContext } from "@/lib/scheduling/public";
import { createBookingAction, joinWaitlistAction } from "@/app/book/actions";

/** Title for a session page's metadata (null when it isn't bookable here). */
export async function sessionTitle(sessionSlug: string): Promise<string | null> {
  const { business, isClient } = await publicBookingContext();
  const st = await getBookableSessionType(business.id, sessionSlug, { includeClientsOnly: isClient });
  return st ? st.name : null;
}

/** Public booking page for one session type of the current business. */
export async function SessionBooking({ sessionSlug, searchParams }: { sessionSlug: string; searchParams: Record<string, string | string[] | undefined> }) {
  const { business, viewer, isClient, coaches } = await publicBookingContext();
  const st = await getBookableSessionType(business.id, sessionSlug, { includeClientsOnly: isClient });
  if (!st) notFound();
  const stCoaches = coachesForType(st, coaches);
  if (stCoaches.length === 0) notFound();
  const { date, coach } = searchParams;
  const flow = await bookingFlowProps({
    business,
    sessionType: st,
    coaches,
    client: viewer,
    coach: typeof coach === "string" ? coach : undefined,
    focus: typeof date === "string" ? date : undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/book" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← All sessions with {business.name}
      </Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{st.name}</h1>
            <p className="text-sm text-zinc-500">
              with {stCoaches.length === 1 ? stCoaches[0]!.name : stCoaches.map((c) => c.name).join(", ")}
            </p>
          </div>
          <span className="text-xl font-bold">{priceLabel(st)}</span>
        </div>
        {st.description ? <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{st.description}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{formatDuration(st.duration_minutes)}</Badge>
          <Badge>{locationSummary(st, business.default_location)}</Badge>
          {st.capacity > 1 ? <Badge tone="purple">Group · up to {st.capacity}</Badge> : null}
        </div>
      </Card>
      <BookingFlow {...flow} bookAction={createBookingAction} waitlistAction={joinWaitlistAction} />
    </div>
  );
}
