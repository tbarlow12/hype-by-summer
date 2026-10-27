import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/me",
    name: BRAND_NAME,
    short_name: BRAND_NAME.length > 12 ? BRAND_NAME.split(/\s+/)[0] : BRAND_NAME,
    description: "Book sessions, follow your training plan, log workouts and message your coach.",
    start_url: "/me",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#e11d48",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Book a session", url: "/me/book" },
      { name: "My plan", url: "/me/plan" },
      { name: "Messages", url: "/me/messages" },
    ],
  };
}
