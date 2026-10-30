// Derives a legible palette from any brand color a trainer picks: button fill,
// text on the button, and brand-colored text that passes WCAG AA (4.5:1) on
// both the light and dark page backgrounds.

const LIGHT_BG = "#fafafa";
const DARK_BG = "#09090b";
export const DEFAULT_BRAND = "#e11d48";

type RGB = [number, number, number];

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** Mix toward black (amount < 0) or white (amount > 0), amount in [-1, 1]. */
function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(toRgb(hex).map((c) => c + (target - c) * t) as RGB);
}
/** Darken (dir -1) or lighten (dir +1) in small steps until it reaches `ratio` against `bg`. */
function untilContrast(hex: string, bg: string, ratio: number, dir: -1 | 1): string {
  let c = hex;
  for (let i = 1; i <= 20 && contrast(c, bg) < ratio; i++) c = shade(hex, dir * i * 0.05);
  return c;
}

export type BrandPalette = {
  brand: string;        // button / accent fill
  brandDark: string;    // hover fill
  onBrand: string;      // text on the fill
  textLight: string;    // brand-colored text on the light page
  textDark: string;     // brand-colored text on the dark page
};

export function brandPalette(input: string | null | undefined): BrandPalette {
  const brand = isHexColor(input) ? input.toLowerCase() : DEFAULT_BRAND;
  const onBrand = contrast(brand, "#ffffff") >= contrast(brand, "#111111") ? "#ffffff" : "#111111";
  return {
    brand,
    brandDark: shade(brand, onBrand === "#ffffff" ? -0.15 : 0.15),
    onBrand,
    textLight: untilContrast(brand, LIGHT_BG, 4.5, -1),
    textDark: untilContrast(brand, DARK_BG, 4.5, 1),
  };
}
