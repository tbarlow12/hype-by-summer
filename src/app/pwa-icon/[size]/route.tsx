import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/clients/brand-mark";

const SIZES = new Set([192, 512]);

/** PNG app icons for the web manifest: /pwa-icon/192, /pwa-icon/512 (?maskable=1 for full-bleed). */
export async function GET(request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  return new ImageResponse(<BrandMark size={size} maskable={maskable} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400, immutable" },
  });
}
