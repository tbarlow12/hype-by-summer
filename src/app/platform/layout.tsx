import Link from "next/link";
import type { Metadata } from "next";
import { getProfile } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/platform";
import { platformFontClass } from "./fonts";
import { PlatformLogo } from "./_components/logo";
import { PLink } from "./_components/ui";
import "./platform.css";

// The platform's own site (served on the platform domain; proxy.ts rewrites
// /, /pricing, /start, /admin, /features, /legal here). It sells the product
// to trainers and never lists or links the businesses that use it.

export const metadata: Metadata = {
  title: { default: `${PLATFORM_NAME}: your personal training business, on your brand`, template: `%s · ${PLATFORM_NAME}` },
  description:
    "Booking, payments, programming, a client app, chat and lead funnels for personal trainers and studios. Your brand, your domain.",
  openGraph: { siteName: PLATFORM_NAME, type: "website" },
};

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
];

export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const profile = await getProfile();
  const account = profile ? { href: profile.is_platform_admin ? "/admin" : "/start", label: "Dashboard" } : null;
  const year = new Date().getFullYear();
  return (
    <div className={`platform-site ${platformFontClass} flex min-h-screen flex-1 flex-col`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b p-line bg-[color-mix(in_oklab,var(--background)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label={`${PLATFORM_NAME} home`} className="mr-auto">
            <PlatformLogo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3 py-2 text-sm font-medium p-muted hover:text-[var(--foreground)]">
                {n.label}
              </Link>
            ))}
            {account ? null : (
              <Link href="/login" className="rounded-full px-3 py-2 text-sm font-medium p-muted hover:text-[var(--foreground)]">
                Sign in
              </Link>
            )}
          </nav>
          {account ? (
            <PLink href={account.href} variant="ink">
              {account.label}
            </PLink>
          ) : (
            <PLink href="/start">Start free</PLink>
          )}
          <details className="relative sm:hidden">
            <summary aria-label="Menu" className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border p-line [&::-webkit-details-marker]:hidden">
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="p-surface absolute right-0 top-12 flex w-48 flex-col rounded-2xl border p-line p-2 shadow-xl">
              {[...NAV, ...(account ? [] : [{ href: "/login", label: "Sign in" }])].map((n) => (
                <Link key={n.href} href={n.href} className="rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)]">
                  {n.label}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </header>
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <footer className="border-t p-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-[2fr_1fr_1fr] sm:px-6">
          <div>
            <PlatformLogo />
            <p className="mt-3 max-w-sm text-sm p-muted">
              The all-in-one platform for personal trainers and studios. Your brand on every screen, email and text.
            </p>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">Product</p>
            <Link href="/features" className="p-muted hover:text-brand">Features</Link>
            <Link href="/pricing" className="p-muted hover:text-brand">Pricing</Link>
            <Link href="/start" className="p-muted hover:text-brand">Start free</Link>
          </nav>
          <nav aria-label="Company" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">Company</p>
            <Link href="/login" className="p-muted hover:text-brand">Sign in</Link>
            <Link href="/legal" className="p-muted hover:text-brand">Terms &amp; privacy</Link>
          </nav>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-10 text-xs p-muted sm:px-6">
          © {year} {PLATFORM_NAME}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
