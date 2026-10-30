import type { Metadata } from "next";
import { SessionBooking, sessionTitle } from "@/components/scheduling/session-booking";
import { Storefront } from "@/components/scheduling/storefront";
import { isBusinessSlug, publicBookingContext } from "@/lib/scheduling/public";

// /book/<segment>: the business's own slug (legacy storefront links) shows the
// booking page; anything else is a session slug (/book/<session>).

export async function generateMetadata({ params }: PageProps<"/book/[trainer]">): Promise<Metadata> {
  const { trainer: segment } = await params;
  const { business } = await publicBookingContext();
  if (isBusinessSlug(segment, business)) return { title: `Book with ${business.name}` };
  const title = await sessionTitle(segment);
  return { title: title ?? "Book a session" };
}

export default async function BookSegmentPage({ params, searchParams }: PageProps<"/book/[trainer]">) {
  const { trainer: segment } = await params;
  const sp = await searchParams;
  const { business } = await publicBookingContext();
  if (isBusinessSlug(segment, business)) return <Storefront coach={typeof sp.coach === "string" ? sp.coach : undefined} />;
  return <SessionBooking sessionSlug={segment} searchParams={sp} />;
}
