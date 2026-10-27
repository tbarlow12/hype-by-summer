import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/clients/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so render full-bleed.
export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} maskable />, size);
}
