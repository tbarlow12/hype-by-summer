import type { Metadata } from "next";
import Link from "next/link";
import { Alert, EmptyState, LinkButton } from "@/components/ui";
import { CheckIcon, GuideCover } from "@/components/marketing/sections";
import { getSiteContext } from "@/lib/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const { business } = await getSiteContext();
  return {
    title: "Free guides",
    description: `Free workout plans, nutrition guides and trackers from ${business.name}. Download instantly.`,
    alternates: { canonical: "/free" },
    openGraph: { title: `Free guides · ${business.name}`, url: "/free" },
  };
}

const DOWNLOAD_ERRORS: Record<string, string> = {
  expired: "That download link has expired. Request the guide again below and we'll send you a fresh link.",
  unavailable: "That guide isn't available right now. Please try again later or pick another guide.",
};

export default async function FreeGuidesPage({ searchParams }: PageProps<"/free">) {
  const { download } = await searchParams;
  const { magnets } = await getSiteContext();
  const downloadError =
    typeof download === "string" ? (DOWNLOAD_ERRORS[download] ?? "That download link isn't valid. Request the guide again below.") : null;
  return (
    <div className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Free resources</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">Free guides</h1>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
            Practical, no-fluff plans you can start today. Grab one, it&apos;s free.
          </p>
        </div>
        {downloadError ? (
          <div className="mt-8 max-w-2xl">
            <Alert tone="amber">{downloadError}</Alert>
          </div>
        ) : null}
        {magnets.length ? (
          <ul className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {magnets.map((m) => (
              <li key={m.id} className="group flex flex-col">
                <Link href={`/free/${m.slug}`} className="block transition-transform group-hover:-translate-y-1">
                  <GuideCover title={m.title} src={m.cover_image_url} />
                </Link>
                <h2 className="mt-5 text-xl font-bold tracking-tight">
                  <Link href={`/free/${m.slug}`} className="hover:text-brand">
                    {m.title}
                  </Link>
                </h2>
                {m.subtitle ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{m.subtitle}</p> : null}
                {m.bullet_points.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {m.bullet_points.slice(0, 3).map((b) => (
                      <li key={b} className="flex gap-2 text-sm">
                        <CheckIcon className="size-4" />
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-5">
                  <LinkButton href={`/free/${m.slug}`}>Get it free</LinkButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-12">
            <EmptyState
              title="New guides are on the way"
              description="There aren't any free guides available right now. Check back soon, or book a free consult to get personal advice."
              action={<LinkButton href="/">Back to home</LinkButton>}
            />
          </div>
        )}
      </div>
    </div>
  );
}
