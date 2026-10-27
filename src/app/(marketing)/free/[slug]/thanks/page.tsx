import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, LinkButton, buttonClass } from "@/components/ui";
import { CheckIcon, GuideCover } from "@/components/marketing/sections";
import { downloadUrl, verifyDownloadTokenValue } from "@/lib/leads";
import { consultHref, getActiveMagnetBySlug, getPublicSessionTypes } from "@/lib/marketing";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDuration } from "@/lib/format";

export const metadata: Metadata = {
  title: "Your guide is on its way",
  robots: { index: false, follow: false },
};

export default async function ThanksPage({ params, searchParams }: PageProps<"/free/[slug]/thanks">) {
  const { slug } = await params;
  const { t } = await searchParams;
  const magnet = await getActiveMagnetBySlug(slug);
  if (!magnet) notFound();

  const token = typeof t === "string" ? t : undefined;
  const verified = token ? verifyDownloadTokenValue(token) : null;
  const valid = verified?.ok && verified.claims.magnetId === magnet.id ? verified : null;

  const admin = createAdminClient();
  const [{ data: lead }, { data: trainer }, types] = await Promise.all([
    valid
      ? admin.from("leads").select("first_name").eq("id", valid.claims.leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("trainer_profiles").select("slug").eq("trainer_id", magnet.trainer_id).maybeSingle(),
    getPublicSessionTypes(magnet.trainer_id),
  ]);
  const consult = types.find((s) => s.is_consultation);
  const bookHref = trainer ? consultHref(trainer, types) : "/";

  return (
    <div className="px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <div className="grid items-center gap-10 sm:grid-cols-[1fr_14rem]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckIcon className="size-4 text-emerald-600" /> You&apos;re in
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-balance sm:text-5xl">
              {lead?.first_name ? `Thanks, ${lead.first_name}!` : "Thanks!"} Your guide is ready.
            </h1>
            <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
              {magnet.thank_you_message ??
                "Download it now. We've also emailed you a link so you can grab it later on any device."}
            </p>
            <div className="mt-8">
              {valid && magnet.file_path ? (
                <a href={downloadUrl(token!)} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
                  <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
                    <path d="M10 2a1 1 0 011 1v8.6l2.3-2.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L9 11.6V3a1 1 0 011-1zM4 15a1 1 0 011 1v1h10v-1a1 1 0 112 0v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2a1 1 0 011-1z" />
                  </svg>
                  Download the PDF
                </a>
              ) : valid ? (
                <Alert tone="amber">The PDF is being finalized. We&apos;ll email it to you as soon as it&apos;s ready.</Alert>
              ) : (
                <Alert>Check your inbox for an email with your download link. It can take a minute or two; peek in Promotions or Spam too.</Alert>
              )}
            </div>
          </div>
          <div className="mx-auto w-40 sm:w-full">
            <GuideCover title={magnet.title} src={magnet.cover_image_url} className="rotate-3" />
          </div>
        </div>

        <div className="relative mt-16 overflow-hidden rounded-[2rem] bg-zinc-950 p-8 text-white sm:p-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(225,29,72,0.5),transparent_50%)]" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Next step</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Want results faster? Get a plan built for you.</h2>
            <p className="mt-4 text-zinc-300">
              The guide is a great start. On a free {consult ? `${formatDuration(consult.duration_minutes)} ` : ""}consult we&apos;ll
              look at your goals, schedule and history and map out exactly what your first month should look like.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-zinc-200">
              {["100% free, zero pressure", "Personal plan and next steps", "In person or online"].map((x) => (
                <li key={x} className="flex gap-2">
                  <CheckIcon /> {x}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <LinkButton href={bookHref} size="lg">
                Book my free consult
              </LinkButton>
              <Link href="/" className={buttonClass("ghost", "lg", "text-white hover:bg-white/10 dark:hover:bg-white/10")}>
                Explore coaching
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
