import "server-only";

// OWNER: communication. Contract used by others to drop events into the
// trainer/client chat thread (e.g. "Booked: Tue 6:00am", "New program assigned").

export async function sendSystemMessage(input: {
  trainerId: string;
  clientId: string;
  body: string;
}): Promise<void> {
  void input;
  throw new Error("not implemented");
}
