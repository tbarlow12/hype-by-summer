import "server-only";

// OWNER: payments. Contract used by scheduling (cancellations / no-shows).

/** Refund the Stripe payment attached to a booking (full by default). No-op if none. */
export async function refundBookingPayment(
  bookingId: string,
  opts?: { amountCents?: number; reason?: string },
): Promise<{ refundedCents: number }> {
  void bookingId;
  void opts;
  throw new Error("not implemented");
}

/**
 * Charge the trainer's late-cancel or no-show fee to the client's saved card
 * (off-session). Records a `fee` payment. Returns ok=false with a reason when
 * there is no fee configured or no saved payment method.
 */
export async function chargeBookingFee(
  bookingId: string,
  kind: "late_cancel" | "no_show",
): Promise<{ ok: boolean; error?: string; amountCents?: number }> {
  void bookingId;
  void kind;
  throw new Error("not implemented");
}
