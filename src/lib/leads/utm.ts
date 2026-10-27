// UTM link builder for sharing lead magnets / pages. Pure.

export type UtmParams = { source?: string; medium?: string; campaign?: string; content?: string; term?: string };

const slugish = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._~-]/g, "")
    .slice(0, 100);

/** Appends normalized utm_* params (lowercase, hyphenated) to a URL, replacing existing ones. */
export function buildUtmUrl(base: string, params: UtmParams): string {
  const url = new URL(base);
  for (const key of ["source", "medium", "campaign", "content", "term"] as const) {
    const raw = params[key];
    const v = raw ? slugish(raw) : "";
    if (v) url.searchParams.set(`utm_${key}`, v);
    else url.searchParams.delete(`utm_${key}`);
  }
  return url.toString();
}

export const UTM_PRESETS: { label: string; source: string; medium: string }[] = [
  { label: "Instagram bio", source: "instagram", medium: "social" },
  { label: "Instagram story", source: "instagram", medium: "story" },
  { label: "Facebook", source: "facebook", medium: "social" },
  { label: "TikTok", source: "tiktok", medium: "social" },
  { label: "Email newsletter", source: "newsletter", medium: "email" },
  { label: "Paid ad", source: "meta", medium: "paid" },
  { label: "Flyer / QR code", source: "flyer", medium: "offline" },
];
