import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { getMembership, getProfile } from "@/lib/auth";
import { consultHref, getSiteContext } from "@/lib/marketing";

// A business's public site: header/footer show only this business (resolved
// from the host; unknown hosts 404 via getSiteContext → requireBusiness).
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const [{ business, magnets, types }, profile] = await Promise.all([getSiteContext(), getProfile()]);
  const membership = profile ? await getMembership() : null;
  const bookHref = "/book";
  const guideHref = magnets.length === 1 ? `/free/${magnets[0]!.slug}` : magnets.length ? "/free" : null;
  const account = profile ? (membership ? { href: "/coach", label: "Coach portal" } : { href: "/me", label: "My account" }) : null;
  const year = new Date().getFullYear();
  const instagram = business.instagram_handle?.replace(/^@/, "") || null;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand">
        Skip to content
      </a>
      <SiteHeader nav={{ brandName: business.name, logoUrl: business.logo_url, bookHref, guideHref, account }} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="lg:col-span-2">
            {business.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logo_url} alt={business.name} className="h-10 w-auto max-w-[12rem] object-contain" />
            ) : (
              <p className="text-lg font-black tracking-tight text-brand">{business.name}</p>
            )}
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              {business.headline ?? "Personal training, online coaching and programs that fit real life."}
            </p>
            {instagram ? (
              <a
                href={`https://instagram.com/${instagram}`}
                className="mt-3 inline-block text-sm font-medium text-zinc-700 hover:text-brand dark:text-zinc-300"
                rel="noopener noreferrer"
                target="_blank"
              >
                @{instagram} on Instagram
              </a>
            ) : null}
            {business.support_email ? (
              <a href={`mailto:${business.support_email}`} className="mt-1 block text-sm text-zinc-600 hover:text-brand dark:text-zinc-400">
                {business.support_email}
              </a>
            ) : null}
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">Train</p>
            {types.some((t) => t.is_consultation) ? (
              <Link href={consultHref(business, types)} className="text-zinc-600 hover:text-brand dark:text-zinc-400">
                Free consult
              </Link>
            ) : null}
            <Link href={bookHref} className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Book a session
            </Link>
            <Link href="/pricing" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Pricing
            </Link>
            {magnets.length ? (
              <Link href="/free" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
                Free guides
              </Link>
            ) : null}
          </nav>
          <nav aria-label="Account" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">Clients</p>
            <Link href="/login" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Sign in
            </Link>
            <Link href="/me" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Client portal
            </Link>
            <Link href="/#contact" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Contact
            </Link>
          </nav>
        </div>
        <p className="border-t border-zinc-200 px-4 py-5 text-center text-xs text-zinc-500 dark:border-zinc-800">
          © {year} {business.name}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
