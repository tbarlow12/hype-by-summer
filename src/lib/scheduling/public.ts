import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getMembership, getProfile } from "@/lib/auth";
import { requireBusiness, type Business } from "@/lib/tenant";
import { clientRelationship, listCoaches } from "./availability";

// Context for the public booking pages and actions. The business always comes
// from the request host (never from the URL or the form); public reads use the
// service role scoped to that business id.

export const publicBookingContext = cache(async () => {
  const business = await requireBusiness();
  const [profile, membership, coaches] = await Promise.all([getProfile(), getMembership(), listCoaches(business.id, { bookableOnly: true })]);
  // Staff browsing their own site book as guests; anyone else signed in books as themselves.
  const viewer = profile && !membership ? profile : null;
  const relationship = viewer ? await clientRelationship(viewer.id, business.id) : null;
  return { business, viewer, relationship, isClient: Boolean(relationship), coaches };
});

/** Legacy `/book/<slug>/…` links: the slug must be this business's, else 404. */
export function assertBusinessSlug(segment: string, business: Pick<Business, "slug">): void {
  if (decodeURIComponent(segment).toLowerCase() !== business.slug.toLowerCase()) notFound();
}

/** True when the URL segment is this business's slug (vs. a session slug). */
export function isBusinessSlug(segment: string, business: Pick<Business, "slug">): boolean {
  return decodeURIComponent(segment).toLowerCase() === business.slug.toLowerCase();
}
