import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui";
import { NotificationsBell } from "@/components/notifications-bell";
import { NavLinks, type NavItem } from "./nav-links";

export function AppShell({
  brandName,
  logoUrl,
  businessId,
  nav,
  user,
  badge,
  children,
}: {
  /** The business's name (white-label: never the platform's). */
  brandName: string;
  logoUrl?: string | null;
  /** Current business: the bell shows only its notifications. */
  businessId?: string | null;
  nav: NavItem[];
  user: { name: string; avatarUrl?: string | null; subtitle?: string };
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <aside className="border-b border-zinc-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-4">
            <Link href="/" className="text-lg font-extrabold tracking-tight text-brand">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={brandName} className="h-8 w-auto max-w-[160px] object-contain" />
              ) : (
                brandName
              )}
            </Link>
            <div className="flex items-center gap-1">
              {badge}
              <NotificationsBell businessId={businessId ?? null} />
            </div>
          </div>
          <NavLinks items={nav} />
          <div className="mt-auto hidden items-center gap-3 border-t border-zinc-200 px-5 py-4 lg:flex dark:border-zinc-800">
            <Avatar name={user.name} src={user.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              {user.subtitle ? <p className="truncate text-xs text-zinc-500">{user.subtitle}</p> : null}
            </div>
            <form action="/auth/signout" method="post">
              <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
