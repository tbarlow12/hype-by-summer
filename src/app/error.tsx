"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/components/ui";

// Shown when a page fails to render (details are in the server logs).
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error && "digest" in error ? String(error.digest) : null;
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Something went wrong</p>
      <h1 className="mt-3 text-4xl font-black">We hit a snag</h1>
      <p className="mt-3 max-w-md text-zinc-600 dark:text-zinc-400">
        This page didn&apos;t load. Try again, and if it keeps happening, let us know.
      </p>
      <div className="mt-8 flex gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/" className={buttonClass("outline")}>
          Home
        </Link>
      </div>
      {digest ? <p className="mt-8 font-mono text-xs text-zinc-500">Error ID: {digest}</p> : null}
    </main>
  );
}
