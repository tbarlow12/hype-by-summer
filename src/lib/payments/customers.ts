import "server-only";

// OWNER: payments.

/** Returns the Stripe customer id for a profile, creating + saving it if needed. */
export async function getOrCreateStripeCustomer(profileId: string): Promise<string> {
  void profileId;
  throw new Error("not implemented");
}
