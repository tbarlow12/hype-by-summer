import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { BRAND_NAME } from "@/lib/env";
import { CloseOnNavigate } from "./close-on-navigate";

export type SiteNav = {
  bookHref: string;
  guideHref: string;
  account: { href: string; label: string } | null;
};

/** Public site header: sticky, with a no-JS disclosure menu on mobile. */
export function SiteHeader({ nav }: { nav: SiteNav }) {
  const links = [
    { href: "/", label: "Home" },
    { href: nav.bookHref, label: "Book" },
    { href: "/pricing", label: "Pricing" },
    { href: nav.guideHref, label: "Free guide" },
  ];
  const account = nav.account ?? { href: "/login", label: "Sign in" };
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/85 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-tight text-brand">
          {BRAND_NAME}
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <Link href={account.href} className={buttonClass("secondary", "sm", "ml-2")}>
            {account.label}
          </Link>
        </nav>
        <CloseOnNavigate className="group relative md:hidden">
          <summary
            className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900 [&::-webkit-details-marker]:hidden"
            aria-label="Menu"
          >
            <svg viewBox="0 0 24 24" className="size-6 group-open:hidden" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
            <svg viewBox="0 0 24 24" className="hidden size-6 group-open:block" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </summary>
          <nav
            aria-label="Mobile"
            className="absolute right-0 mt-2 flex w-56 flex-col gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            {links.map((l) => (
              <Link key={l.label} href={l.href} className="rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900">
                {l.label}
              </Link>
            ))}
            <Link href={account.href} className={buttonClass("primary", "md", "mt-1")}>
              {account.label}
            </Link>
          </nav>
        </CloseOnNavigate>
      </div>
    </header>
  );
}
