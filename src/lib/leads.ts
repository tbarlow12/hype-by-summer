import "server-only";
import type { Tables, Enums } from "@/lib/supabase/database.types";
import type { Attribution } from "@/lib/attribution";

// OWNER: leads. Contract used by scheduling (consult bookings), homepage forms.

export type CaptureLeadInput = {
  trainerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  source: "lead_magnet" | "booking" | "contact_form" | "referral" | "manual" | "import";
  leadMagnetId?: string;
  primaryGoal?: string;
  goalDetails?: string;
  experienceLevel?: string;
  preferredFormat?: string;
  budgetRange?: string;
  timeline?: string;
  zipCode?: string;
  howHeard?: string;
  marketingConsent?: boolean;
  consentText?: string;
  attribution?: Attribution;
  ipAddress?: string;
  userAgent?: string;
};

/** Upserts a lead (merging repeat submissions) and logs a `captured` event. */
export async function captureLead(input: CaptureLeadInput): Promise<Tables<"leads">> {
  void input;
  throw new Error("not implemented");
}

export async function recordLeadEvent(
  leadId: string,
  type: Enums<"lead_event_type">,
  detail?: Record<string, unknown>,
  createdBy?: string,
): Promise<void> {
  void leadId;
  void type;
  void detail;
  void createdBy;
  throw new Error("not implemented");
}
