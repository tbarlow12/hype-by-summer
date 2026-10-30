import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/clients/brand-mark";
import { getBusiness } from "@/lib/tenant";
import { brandMarkProps } from "@/lib/clients/pwa";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Per business (host). iOS rounds the corners itself, so render full-bleed.
export default async function AppleIcon() {
  const mark = await brandMarkProps(await getBusiness());
  return new ImageResponse(<BrandMark size={180} maskable {...mark} />, size);
}
