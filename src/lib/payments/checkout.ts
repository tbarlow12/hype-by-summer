import "server-only";

// OWNER: payments. Contract used by scheduling.

/**
 * Creates a Stripe Checkout Session for a `pending_payment` booking and stores
 * its id on the booking. The Stripe webhook later confirms the booking and
 * calls onBookingConfirmed(). Returns the Checkout URL to redirect to.
 */
export async function createBookingCheckout(bookingId: string): Promise<{ url: string }> {
  void bookingId;
  throw new Error("not implemented");
}
