import { ImageResponse } from "next/og";
import { BrandMark } from "@/components/clients/brand-mark";
import { getBusiness } from "@/lib/tenant";
import { brandMarkProps } from "@/lib/clients/pwa";

const SIZES = new Set([192, 512]);

/**
 * PNG app icons for the web manifest of the business this host serves:
 * /pwa-icon/192, /pwa-icon/512 (?maskable=1 for full-bleed). The manifest
 * adds ?v=<hash> so a new logo or color shows up right away.
 */
export async function GET(request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  const mark = await brandMarkProps(await getBusiness());
  return new ImageResponse(<BrandMark size={size} maskable={maskable} {...mark} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400", Vary: "Host" },
  });
}
