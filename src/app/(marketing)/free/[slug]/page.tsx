import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeadMagnetForm } from "@/components/lead-magnet-form";
import { CheckIcon, GuideCover, Stars } from "@/components/marketing/sections";
import { Avatar } from "@/components/ui";
import { BRAND_NAME } from "@/lib/env";
import { coachName, getActiveMagnetBySlug, getApprovedTestimonials } from "@/lib/marketing";
import { getTrainerBySlug } from "@/lib/trainer";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata({ params }: PageProps<"/free/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const magnet = await getActiveMagnetBySlug(slug);
  if (!magnet) return { title: "Guide not found", robots: { index: false } };
  const description = magnet.subtitle ?? magnet.description?.slice(0, 160) ?? `A free guide from ${BRAND_NAME}.`;
  return {
    title: `${magnet.title} (free guide)`,
    description,
    alternates: { canonical: `/free/${magnet.slug}` },
    openGraph: {
      title: magnet.title,
      description,
      url: `/free/${magnet.slug}`,
      images: magnet.cover_image_url ? [{ url: magnet.cover_image_url }] : undefined,
    },
  };
}

async function trainerFor(trainerId: string) {
  const { data } = await createAdminClient().from("trainer_profiles").select("slug").eq("trainer_id", trainerId).maybeSingle();
  return data ? getTrainerBySlug(data.slug) : null;
}

export default async function LeadMagnetPage({ params }: PageProps<"/free/[slug]">) {
  const { slug } = await params;
  const magnet = await getActiveMagnetBySlug(slug);
  if (!magnet) notFound();
  const [trainer, testimonials] = await Promise.all([trainerFor(magnet.trainer_id), getApprovedTestimonials(magnet.trainer_id)]);
  const quote = testimonials.find((t) => t.body.length < 280) ?? null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-gradient-to-b from-rose-50 to-transparent dark:from-rose-950/30" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Free guide</p>
          <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-balance sm:text-5xl">{magnet.title}</h1>
          {magnet.subtitle ? <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">{magnet.subtitle}</p> : null}
          <div className="mx-auto mt-8 max-w-xs lg:mx-0">
            <GuideCover title={magnet.title} src={magnet.cover_image_url} className="-rotate-2" />
          </div>
          {magnet.description ? (
            <div className="mt-10 space-y-3 text-zinc-700 dark:text-zinc-300">
              {magnet.description.split(/\n{2,}/).map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          ) : null}
          {magnet.bullet_points.length ? (
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What&apos;s inside</h2>
              <ul className="mt-4 space-y-3">
                {magnet.bullet_points.map((b) => (
                  <li key={b} className="flex gap-3 font-medium">
                    <CheckIcon />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-xl sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-2xl font-black tracking-tight">Where should we send it?</h2>
            <p className="mt-1 text-sm text-zinc-500">Instant download, plus a copy in your inbox.</p>
            <div className="mt-6">
              <LeadMagnetForm magnet={{ id: magnet.id, cta_label: magnet.cta_label, ask_phone: magnet.ask_phone, ask_goal: magnet.ask_goal }} />
            </div>
          </div>
          {trainer ? (
            <div className="mt-6 flex items-center gap-3 px-2">
              <Avatar name={coachName(trainer).full} src={trainer.profiles?.avatar_url} size={44} />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Created by <span className="font-semibold text-zinc-900 dark:text-zinc-100">{coachName(trainer).full}</span>
                {trainer.certifications[0] ? `, ${trainer.certifications[0]}` : ""}
              </p>
            </div>
          ) : null}
          {quote ? (
            <figure className="mt-6 rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900/60">
              {quote.rating ? <Stars rating={quote.rating} /> : null}
              <blockquote className="mt-2 text-sm">&ldquo;{quote.body}&rdquo;</blockquote>
              <figcaption className="mt-2 text-xs font-semibold text-zinc-500">{quote.author_name}</figcaption>
            </figure>
          ) : null}
        </div>
      </div>
    </div>
  );
}
