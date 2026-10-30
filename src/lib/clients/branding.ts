// Branding options shared by Settings → Branding, the PWA icons and tests.
import { brandPalette, contrast } from "@/lib/brand-palette";

export const FONT_PRESETS = [
  {
    value: "athletic",
    label: "Athletic",
    description: "Squared, condensed headlines. Bold and sporty.",
    sans: "var(--font-barlow)",
    display: "var(--font-barlow-condensed)",
    uppercase: true,
  },
  {
    value: "modern",
    label: "Modern",
    description: "Clean geometric sans. Calm and premium.",
    sans: "var(--font-manrope)",
    display: "var(--font-sora)",
    uppercase: false,
  },
  {
    value: "classic",
    label: "Classic",
    description: "Elegant serif headlines with a readable sans.",
    sans: "var(--font-source-sans)",
    display: "var(--font-fraunces)",
    uppercase: false,
  },
  {
    value: "rounded",
    label: "Rounded",
    description: "Soft, friendly letterforms.",
    sans: "var(--font-nunito)",
    display: "var(--font-nunito)",
    uppercase: false,
  },
] as const;

export type FontPreset = (typeof FONT_PRESETS)[number]["value"];
export const FONT_PRESET_VALUES = FONT_PRESETS.map((f) => f.value) as [FontPreset, ...FontPreset[]];

const LIGHT_BG = "#fafafa";
const DARK_BG = "#09090b";

export type ContrastWarning = { level: "warn" | "info"; message: string };

/**
 * Plain-language warnings for a brand color. The palette always adjusts text
 * to stay legible; these say when the result will look noticeably different
 * from the picked color or when buttons fade into the page.
 */
export function brandContrastWarnings(hex: string): ContrastWarning[] {
  const p = brandPalette(hex);
  const out: ContrastWarning[] = [];
  if (contrast(p.brand, p.onBrand) < 4.5) {
    out.push({ level: "warn", message: "Button text is hard to read on this color. Try a darker or lighter shade." });
  }
  if (contrast(p.brand, LIGHT_BG) < 1.5) {
    out.push({ level: "warn", message: "Buttons barely stand out on the light background." });
  }
  if (contrast(p.brand, DARK_BG) < 1.5) {
    out.push({ level: "warn", message: "Buttons barely stand out in dark mode." });
  }
  if (p.textLight !== p.brand) {
    out.push({ level: "info", message: "Links and headings use a darker shade on light backgrounds so they stay readable." });
  }
  if (p.textDark !== p.brand) {
    out.push({ level: "info", message: "Links and headings use a lighter shade in dark mode so they stay readable." });
  }
  return out;
}

/** Up to two initials for a generated monogram icon ("HYPE by Summer" -> "HS"). */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !["by", "the", "and", "of", "&"].includes(w.toLowerCase()));
  if (!words.length) return "?";
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase();
}
