import type { MetadataRoute } from "next";
import { brandOf, getBusiness } from "@/lib/tenant";
import { iconVersion } from "@/lib/clients/pwa";

// Each business's site installs as its own app: its name, colors and icon.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const business = await getBusiness();
  const brand = brandOf(business);
  const v = iconVersion(business);
  const name = brand.name;
  return {
    id: "/me",
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0]!.slice(0, 12) : name,
    description: business?.headline ?? "Book sessions, follow your training plan, log workouts and message your coach.",
    start_url: "/me",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: brand.palette.brand,
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: `/pwa-icon/192?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/pwa-icon/512?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/pwa-icon/512?maskable=1&v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Book a session", url: "/me/book" },
      { name: "My plan", url: "/me/plan" },
      { name: "Messages", url: "/me/messages" },
    ],
  };
}
