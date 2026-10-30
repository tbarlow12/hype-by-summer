import type { MetadataRoute } from "next";
import { getActiveMagnets, getPublicCoaches, getPublicSessionTypes, coachBookHref, sessionBookHref } from "@/lib/marketing";
import { platformUrl } from "@/lib/platform";
import { businessUrl, getBusiness } from "@/lib/tenant";

// Per host: a business's site lists only its own public pages; the platform's
// own host lists the platform's marketing pages.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const business = await getBusiness();
  if (!business) {
    return [
      { url: platformUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
      { url: platformUrl("/features"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
      { url: platformUrl("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
      { url: platformUrl("/start"), lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ];
  }

  const url = (path: string) => businessUrl(business, path);
  const entries: MetadataRoute.Sitemap = [
    { url: url("/"), lastModified: new Date(business.updated_at), changeFrequency: "weekly", priority: 1 },
    { url: url("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: url("/book"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
  ];
  try {
    const [magnets, types, coaches] = await Promise.all([
      getActiveMagnets(business.id),
      getPublicSessionTypes(business.id),
      getPublicCoaches(business.id),
    ]);
    for (const t of types) {
      entries.push({ url: url(sessionBookHref(business, t)), changeFrequency: "weekly", priority: t.is_consultation ? 0.9 : 0.6 });
    }
    if (coaches.length > 1) {
      for (const c of coaches) if (c.slug) entries.push({ url: url(coachBookHref(c)), changeFrequency: "weekly", priority: 0.7 });
    }
    if (magnets.length) entries.push({ url: url("/free"), lastModified: now, changeFrequency: "weekly", priority: 0.7 });
    for (const m of magnets) {
      entries.push({ url: url(`/free/${m.slug}`), lastModified: new Date(m.updated_at), changeFrequency: "monthly", priority: 0.8 });
    }
  } catch (err) {
    console.error("[sitemap] failed to list public pages", err);
  }
  return entries;
}
