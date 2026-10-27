import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, buttonClass } from "@/components/ui";
import { getProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { retrieveOwnCheckoutSession } from "@/lib/payments/checkout";
import { fulfillCheckoutSession } from "@/lib/payments/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };

export default async function CheckoutSuccessPage({ searchParams }: PageProps<"/checkout/success">) {
  const { session_id } = await searchParams;
  const profile = await getProfile();

  let summary: { name: string; amount: string | null; kind: string; credits: number; trialDays: number; download: boolean } | null = null;
  let pending = false;
  if (profile && typeof session_id === "string" && /^cs_[A-Za-z0-9_]+$/.test(session_id)) {
    try {
      const session = await retrieveOwnCheckoutSession(session_id, profile.id);
      if (session) {
        // Don't wait for the webhook: fulfilment is idempotent, so do it now too.
        if (session.status === "complete") await fulfillCheckoutSession(session);
        pending = session.payment_status === "unpaid";
        const offeringId = session.metadata?.offering_id;
        const { data: offering } = offeringId
          ? await createAdminClient()
              .from("offerings")
              .select("name, kind, credits, trial_days, digital_file_path")
              .eq("id", offeringId)
              .maybeSingle()
          : { data: null };
        summary = {
          name: offering?.name ?? "your purchase",
          amount: session.amount_total != null ? formatMoney(session.amount_total, session.currency ?? "usd") : null,
          kind: offering?.kind ?? session.metadata?.kind ?? "",
          credits: offering?.credits ?? 0,
          trialDays: offering?.trial_days ?? 0,
          download: Boolean(offering?.digital_file_path),
        };
      }
    } catch (err) {
      console.error("[checkout] success page lookup failed", err);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-6">
            <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{pending ? "Payment processing" : "You're all set!"}</h1>
        {summary ? (
          <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <p>
              Thanks for buying <span className="font-semibold text-zinc-900 dark:text-zinc-100">{summary.name}</span>
              {summary.amount ? ` (${summary.amount})` : ""}.
            </p>
            {pending ? <p>Your bank is confirming the payment. We&apos;ll email you as soon as it clears.</p> : null}
            {!pending && summary.kind === "package" && summary.credits > 0 ? (
              <p>{summary.credits} session credit{summary.credits === 1 ? " has" : "s have"} been added to your account.</p>
            ) : null}
            {!pending && summary.kind === "subscription" ? (
              <p>
                Your membership is active{summary.trialDays > 0 ? ` with a ${summary.trialDays}-day free trial` : ""}.
                {summary.credits > 0 ? ` You get ${summary.credits} session credit${summary.credits === 1 ? "" : "s"} each period.` : ""}
              </p>
            ) : null}
            {!pending && summary.kind === "one_time" ? (
              <p>{summary.download ? "Your download link is on its way by email and in your billing page." : "Your coach will be in touch with next steps."}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Your payment was received. A receipt is on its way to your inbox.</p>
        )}
        {!profile ? <Alert tone="neutral">Sign in to see your purchase in your account.</Alert> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {summary?.kind === "package" || summary?.kind === "subscription" ? (
            <Link href="/me/book" className={buttonClass("primary")}>Book a session</Link>
          ) : null}
          <Link href="/me/billing" className={buttonClass(summary?.kind === "one_time" ? "primary" : "outline")}>
            {summary?.download ? "Go to my downloads" : "View billing"}
          </Link>
        </div>
      </Card>
    </div>
  );
}
