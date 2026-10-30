import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { getProfile, homeFor } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/env";
import { consultHref, getSiteContext } from "@/lib/marketing";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const [{ trainer, magnets, types }, profile] = await Promise.all([getSiteContext(), getProfile()]);
  const bookHref = trainer ? `/book/${trainer.slug}` : "/login";
  const guideHref = magnets.length === 1 ? `/free/${magnets[0]!.slug}` : "/free";
  const account = profile ? { href: homeFor(profile), label: profile.role === "client" ? "My account" : "Coach portal" } : null;
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand">
        Skip to content
      </a>
      <SiteHeader nav={{ bookHref, guideHref, account }} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-lg font-black tracking-tight text-brand">{BRAND_NAME}</p>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              {trainer?.headline ?? "Personal training, online coaching and programs that fit real life."}
            </p>
            {trainer?.instagram_handle ? (
              <a
                href={`https://instagram.com/${trainer.instagram_handle.replace(/^@/, "")}`}
                className="mt-3 inline-block text-sm font-medium text-zinc-700 hover:text-brand dark:text-zinc-300"
                rel="noopener noreferrer"
                target="_blank"
              >
                @{trainer.instagram_handle.replace(/^@/, "")} on Instagram
              </a>
            ) : null}
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">Train</p>
            {trainer ? (
              <Link href={consultHref(trainer, types)} className="text-zinc-600 hover:text-brand dark:text-zinc-400">
                Free consult
              </Link>
            ) : null}
            <Link href={bookHref} className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Book a session
            </Link>
            <Link href="/pricing" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Pricing
            </Link>
            <Link href="/free" className="text-zinc-600 hover:text-brand dark:text-zinc-400">
              Free guides
            </Link>
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
          © {year} {BRAND_NAME}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
