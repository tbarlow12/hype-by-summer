import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/env";
import { getActiveMagnets, getPublicSessionTypes } from "@/lib/marketing";
import { getPrimaryTrainer } from "@/lib/trainer";

// Built per request (not at build time), so it never needs database access during `next build`.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/free"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];
  try {
    const trainer = await getPrimaryTrainer();
    if (!trainer) return entries;
    const [magnets, types] = await Promise.all([getActiveMagnets(trainer.trainer_id), getPublicSessionTypes(trainer.trainer_id)]);
    entries.push({ url: absoluteUrl(`/book/${trainer.slug}`), lastModified: new Date(trainer.updated_at), changeFrequency: "weekly", priority: 0.9 });
    for (const t of types) {
      entries.push({ url: absoluteUrl(`/book/${trainer.slug}/${t.slug}`), changeFrequency: "weekly", priority: t.is_consultation ? 0.9 : 0.6 });
    }
    for (const m of magnets) {
      entries.push({ url: absoluteUrl(`/free/${m.slug}`), lastModified: new Date(m.updated_at), changeFrequency: "monthly", priority: 0.8 });
    }
  } catch (err) {
    // Database unavailable (e.g. at build time without env): static entries only.
    console.error("[sitemap] dynamic entries skipped", err);
  }
  return entries;
}
