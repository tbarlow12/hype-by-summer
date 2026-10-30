import "server-only";
import { createHash } from "node:crypto";
import { brandPalette } from "@/lib/brand-palette";
import { PLATFORM_NAME } from "@/lib/platform";
import type { Business } from "@/lib/tenant";
import { monogram } from "./branding";

type IconSource = Pick<Business, "name" | "brand_color" | "logo_url"> | null;

/** Short hash of what the icon is drawn from, so a new logo/color busts caches. */
export function iconVersion(business: IconSource): string {
  return createHash("sha1")
    .update(`${business?.name ?? PLATFORM_NAME}|${business?.brand_color ?? ""}|${business?.logo_url ?? ""}`)
    .digest("hex")
    .slice(0, 10);
}

/** The logo as a data URL (so next/og never fetches remotely mid-render), or null. */
async function logoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Props for <BrandMark>: logo when there is one, else a monogram in the brand colors. */
export async function brandMarkProps(business: IconSource) {
  const palette = brandPalette(business?.brand_color);
  return {
    logoUrl: await logoDataUrl(business?.logo_url),
    initials: monogram(business?.name ?? PLATFORM_NAME),
    background: palette.brand,
    foreground: palette.onBrand,
  };
}
