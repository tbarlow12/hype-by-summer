import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card } from "@/components/ui";
import { BookingFlow } from "@/components/scheduling/booking-flow";
import { getTrainerBySlug } from "@/lib/trainer";
import { getProfile } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { getBookableSessionType, isClientOfTrainer } from "@/lib/scheduling/availability";
import { bookingFlowProps } from "@/lib/scheduling/flow";
import { locationSummary, priceLabel } from "@/lib/scheduling/labels";
import { createBookingAction, joinWaitlistAction } from "../../actions";

export async function generateMetadata({ params }: PageProps<"/book/[trainer]/[session]">): Promise<Metadata> {
  const { trainer: slug, session } = await params;
  const trainer = await getTrainerBySlug(slug);
  const st = trainer ? await getBookableSessionType(trainer.trainer_id, session, { includeClientsOnly: false }) : null;
  return { title: st && trainer ? `${st.name} · ${trainer.business_name}` : "Book a session" };
}

export default async function BookSessionPage({ params, searchParams }: PageProps<"/book/[trainer]/[session]">) {
  const { trainer: slug, session } = await params;
  const { date } = await searchParams;
  const trainer = await getTrainerBySlug(slug);
  if (!trainer) notFound();
  const profile = await getProfile();
  const client = profile?.role === "client" ? profile : null;
  const linked = Boolean(client && (await isClientOfTrainer(client.id, trainer.trainer_id)));
  const st = await getBookableSessionType(trainer.trainer_id, session, { includeClientsOnly: linked });
  if (!st) notFound();
  const flow = await bookingFlowProps({
    trainerId: trainer.trainer_id,
    trainerSlug: trainer.slug,
    sessionType: st,
    client,
    focus: typeof date === "string" ? date : undefined,
  });

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/book/${trainer.slug}`} className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← All sessions with {trainer.business_name}
      </Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{st.name}</h1>
            <p className="text-sm text-zinc-500">with {trainer.profiles?.full_name ?? trainer.business_name}</p>
          </div>
          <span className="text-xl font-bold">{priceLabel(st)}</span>
        </div>
        {st.description ? <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{st.description}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{formatDuration(st.duration_minutes)}</Badge>
          <Badge>{locationSummary(st, trainer.default_location)}</Badge>
          {st.capacity > 1 ? <Badge tone="purple">Group · up to {st.capacity}</Badge> : null}
        </div>
      </Card>
      <BookingFlow {...flow} bookAction={createBookingAction} waitlistAction={joinWaitlistAction} />
    </div>
  );
}
