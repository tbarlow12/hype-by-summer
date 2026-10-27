import "server-only";

// OWNER: scheduling. Contract used by payments (Stripe webhook) and others.

/**
 * Called once a booking becomes `confirmed` (free, credits, or after Stripe
 * payment). Creates the video room for virtual sessions, sends confirmation
 * emails/notifications to client + trainer. Must be idempotent.
 */
export async function onBookingConfirmed(bookingId: string): Promise<void> {
  void bookingId;
  throw new Error("not implemented");
}
