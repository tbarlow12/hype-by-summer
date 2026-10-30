import type { Metadata } from "next";
import { SessionBooking, sessionTitle } from "@/components/scheduling/session-booking";
import { assertBusinessSlug, publicBookingContext } from "@/lib/scheduling/public";

// Legacy /book/<business slug>/<session> links. The slug must be the current
// business's (404 otherwise); new links use /book/<session>.

export async function generateMetadata({ params }: PageProps<"/book/[trainer]/[session]">): Promise<Metadata> {
  const { trainer, session } = await params;
  const { business } = await publicBookingContext();
  assertBusinessSlug(trainer, business);
  return { title: (await sessionTitle(session)) ?? "Book a session" };
}

export default async function BookSessionPage({ params, searchParams }: PageProps<"/book/[trainer]/[session]">) {
  const { trainer, session } = await params;
  const { business } = await publicBookingContext();
  assertBusinessSlug(trainer, business);
  return <SessionBooking sessionSlug={session} searchParams={await searchParams} />;
}
