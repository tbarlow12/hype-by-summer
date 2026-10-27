import type { Metadata } from "next";
import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Checkout cancelled", robots: { index: false } };

export default function CheckoutCancelledPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Checkout cancelled</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No worries, you haven&apos;t been charged. You can pick up where you left off any time.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/pricing" className={buttonClass("primary")}>Back to pricing</Link>
          <Link href="/#contact" className={buttonClass("outline")}>Ask a question</Link>
        </div>
      </Card>
    </div>
  );
}
