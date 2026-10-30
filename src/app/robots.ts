import type { MetadataRoute } from "next";
import { platformUrl } from "@/lib/platform";
import { businessUrl, getBusiness } from "@/lib/tenant";

// Per host: each business site points crawlers at its own sitemap; the
// platform host at the platform's.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const business = await getBusiness();
  if (!business) {
    return {
      rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/coach", "/me", "/api/", "/auth/", "/login", "/signup"] }],
      sitemap: platformUrl("/sitemap.xml"),
      host: platformUrl("/").replace(/\/$/, ""),
    };
  }
  const base = businessUrl(business, "/").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/coach", "/me", "/api/", "/auth/", "/booking/", "/checkout/", "/live", "/unsubscribe/", "/free/*/thanks", "/login", "/signup"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
