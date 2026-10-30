"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export type NavItem = { href: string; label: string; count?: number; section?: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {items.map((item, i) => {
        const root = item.href.split("/").length <= 2;
        const active = root ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const header = item.section && item.section !== items[i - 1]?.section ? item.section : null;
        return (
          <div key={item.href} className="contents">
            {header ? (
              <p className="mt-4 hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 lg:block">
                {header}
              </p>
            ) : null}
            <Link
              href={item.href}
              className={cn(
                "flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
              )}
            >
              {item.label}
              {item.count ? (
                <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand">{item.count}</span>
              ) : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
