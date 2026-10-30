import Link from "next/link";
import type { ReactNode } from "react";
import { getBusiness } from "@/lib/tenant";

/** Minimal chrome for the public booking pages, branded with the host's business. */
export async function PublicShell({ children }: { children: ReactNode }) {
  const business = await getBusiness();
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-brand">
            {business?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- business logos live on arbitrary hosts
              <img src={business.logo_url} alt={business.name} className="h-8 w-auto" />
            ) : (
              business?.name
            )}
          </Link>
          <Link href="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
