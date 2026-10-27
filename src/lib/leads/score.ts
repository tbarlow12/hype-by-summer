// Simple, explainable lead scoring (0–100). Pure: callers pass the lead's
// qualification fields plus engagement facts gathered from lead_events.

export type ScoreInput = {
  phone?: string | null;
  primary_goal?: string | null;
  goal_details?: string | null;
  experience_level?: string | null;
  preferred_format?: string | null;
  budget_range?: string | null;
  timeline?: string | null;
  marketing_consent?: boolean | null;
  unsubscribed_at?: string | null;
  status?: string | null;
};

export type Engagement = {
  /** Number of times the lead submitted a public form (captured events). */
  captures?: number;
  downloadedMagnet?: boolean;
  consultBooked?: boolean;
  sentMessage?: boolean;
};

export type ScoreResult = { score: number; reasons: { label: string; points: number }[] };

const BUDGET_POINTS: Record<string, number> = { under_100: 0, "100_250": 5, "250_500": 10, "500_plus": 15 };
const TIMELINE_POINTS: Record<string, number> = { asap: 20, "1_month": 12, "3_months": 5, exploring: 0 };
const FORMAT_POINTS: Record<string, number> = { in_person: 5, hybrid: 5, virtual: 3, app_only: 2 };

export function scoreLead(lead: ScoreInput, engagement: Engagement = {}): ScoreResult {
  const reasons: ScoreResult["reasons"] = [];
  const add = (label: string, points: number) => {
    if (points) reasons.push({ label, points });
  };

  if (lead.phone?.trim()) add("Shared a phone number", 10);
  if (lead.primary_goal) add("Told us their goal", 5);
  if (lead.goal_details?.trim()) add("Described their goal", 5);
  if (lead.experience_level) add("Shared experience level", 3);
  if (lead.preferred_format) add("Picked a training format", FORMAT_POINTS[lead.preferred_format] ?? 2);
  if (lead.budget_range) add("Budget", BUDGET_POINTS[lead.budget_range] ?? 3);
  if (lead.timeline) add(lead.timeline === "asap" ? "Wants to start ASAP" : "Timeline", TIMELINE_POINTS[lead.timeline] ?? 0);
  if (lead.marketing_consent && !lead.unsubscribed_at) add("Opted in to emails", 5);

  if (engagement.downloadedMagnet) add("Downloaded the free guide", 10);
  if (engagement.sentMessage) add("Sent a message", 10);
  if (engagement.consultBooked || lead.status === "consult_booked") add("Booked a consult", 25);
  const repeats = Math.max(0, (engagement.captures ?? 1) - 1);
  if (repeats) add("Came back again", Math.min(15, repeats * 5));

  if (lead.unsubscribed_at) add("Unsubscribed", -10);
  if (lead.status === "lost") add("Marked lost", -20);

  const total = reasons.reduce((sum, r) => sum + r.points, 0);
  return { score: Math.max(0, Math.min(100, total)), reasons };
}

/** Temperature bucket used for badges. */
export function scoreTier(score: number): "hot" | "warm" | "cold" {
  if (score >= 50) return "hot";
  if (score >= 25) return "warm";
  return "cold";
}
