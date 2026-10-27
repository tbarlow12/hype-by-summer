// Shared option lists for lead forms, the CRM and CSV export (client-safe).

export type Option = { value: string; label: string };

export const GOALS: Option[] = [
  { value: "lose_fat", label: "Lose fat" },
  { value: "build_muscle", label: "Build muscle" },
  { value: "strength", label: "Get stronger" },
  { value: "event_prep", label: "Prep for an event" },
  { value: "postpartum", label: "Postpartum fitness" },
  { value: "general_health", label: "Feel healthier overall" },
];

export const EXPERIENCE_LEVELS: Option[] = [
  { value: "beginner", label: "Beginner (new or returning)" },
  { value: "intermediate", label: "Intermediate (training on and off)" },
  { value: "advanced", label: "Advanced (consistent for years)" },
];

export const FORMATS: Option[] = [
  { value: "in_person", label: "In person" },
  { value: "virtual", label: "Virtual (live video)" },
  { value: "hybrid", label: "Hybrid" },
  { value: "app_only", label: "App-only coaching" },
];

export const TIMELINES: Option[] = [
  { value: "asap", label: "As soon as possible" },
  { value: "1_month", label: "Within a month" },
  { value: "3_months", label: "In the next 3 months" },
  { value: "exploring", label: "Just exploring" },
];

export const BUDGETS: Option[] = [
  { value: "under_100", label: "Under $100 / month" },
  { value: "100_250", label: "$100–250 / month" },
  { value: "250_500", label: "$250–500 / month" },
  { value: "500_plus", label: "$500+ / month" },
];

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "consult_booked",
  "nurturing",
  "converted",
  "lost",
  "unsubscribed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  consult_booked: "Consult booked",
  nurturing: "Nurturing",
  converted: "Client",
  lost: "Lost",
  unsubscribed: "Unsubscribed",
};

export const STATUS_TONES: Record<LeadStatus, "brand" | "blue" | "purple" | "amber" | "green" | "neutral" | "red"> = {
  new: "brand",
  contacted: "blue",
  consult_booked: "purple",
  nurturing: "amber",
  converted: "green",
  lost: "neutral",
  unsubscribed: "red",
};

export const LEAD_SOURCES = ["lead_magnet", "booking", "contact_form", "referral", "manual", "import"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  lead_magnet: "Free guide",
  booking: "Booking",
  contact_form: "Contact form",
  referral: "Referral",
  manual: "Added manually",
  import: "Import",
};

export const LOST_REASONS: Option[] = [
  { value: "price", label: "Price" },
  { value: "timing", label: "Bad timing" },
  { value: "no_response", label: "Stopped responding" },
  { value: "went_elsewhere", label: "Chose another coach/gym" },
  { value: "not_a_fit", label: "Not a fit" },
  { value: "other", label: "Other" },
];

const all = [...GOALS, ...EXPERIENCE_LEVELS, ...FORMATS, ...TIMELINES, ...BUDGETS, ...LOST_REASONS];

/** Human label for any stored option value (falls back to Title Case). */
export function optionLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (
    all.find((o) => o.value === value)?.label ??
    (STATUS_LABELS as Record<string, string>)[value] ??
    (SOURCE_LABELS as Record<string, string>)[value] ??
    value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export const values = (opts: Option[]) => opts.map((o) => o.value) as [string, ...string[]];

/** Default consent copy shown next to the marketing checkbox (stored verbatim on the lead). */
export const consentText = (brand: string) =>
  `Yes, ${brand} can email me training tips, offers and updates. I can unsubscribe at any time.`;
