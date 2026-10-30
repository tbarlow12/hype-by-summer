import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { ActionButton } from "@/components/payments/action-button";
import { Alert, Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { accountRequirements, refreshAccountStatus } from "@/lib/payments/accounts";
import { feePercentLabel } from "@/lib/payments/fees";
import { connectStatus } from "@/lib/payments/mapping";
import { isStripeConfigured } from "@/lib/stripe";
import { connectStripeAction, refreshStripeStatusAction } from "./actions";

export const metadata = { title: "Payments setup" };

const STATUS_COPY = {
  not_connected: { tone: "neutral", label: "Not connected" },
  onboarding: { tone: "amber", label: "Onboarding incomplete" },
  restricted: { tone: "amber", label: "Action needed" },
  active: { tone: "green", label: "Active" },
} as const;

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <span className="text-sm font-medium">{label}</span>
      <Badge tone={on ? "green" : "amber"}>{on ? "Enabled" : "Not yet"}</Badge>
    </div>
  );
}

export default async function PaymentsSetupPage({ searchParams }: PageProps<"/coach/payments/setup">) {
  let { business } = await requireManager();
  const sp = await searchParams;
  // Back from Stripe onboarding: don't wait for account.updated.
  if (sp.return && business.stripe_account_id) business = await refreshAccountStatus(business);
  const status = connectStatus(business);
  const copy = STATUS_COPY[status];
  const requirements = business.stripe_account_id && status !== "active" ? await accountRequirements(business.stripe_account_id) : null;
  const configured = isStripeConfigured();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/coach/payments" className="text-zinc-500 hover:text-brand">← Payments</Link>
      </p>
      <PageHeader
        title="Payments setup"
        description="Clients pay you directly through your own Stripe account. Payouts go to your bank on Stripe's schedule."
      />

      {sp.error === "link" ? <Alert tone="red">We couldn&apos;t open Stripe. Please try again.</Alert> : null}
      {!configured ? <Alert tone="amber">Online payments aren&apos;t available on this platform right now.</Alert> : null}
      {sp.return && status === "active" ? <Alert tone="green">You&apos;re all set: clients can pay online.</Alert> : null}

      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Stripe account</CardTitle>
            <p className="mt-1 text-sm text-zinc-500">
              {status === "not_connected"
                ? "Create or connect a Stripe account for your business. It takes about 5 minutes."
                : status === "onboarding"
                  ? "Stripe still needs some details before you can take payments."
                  : status === "restricted"
                    ? "Stripe needs more information to keep payments or payouts enabled."
                    : "Your account is ready to take payments and receive payouts."}
            </p>
          </div>
          <Badge tone={copy.tone}>{copy.label}</Badge>
        </div>

        {business.stripe_account_id ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <Flag on={business.stripe_details_submitted} label="Details submitted" />
            <Flag on={business.stripe_charges_enabled} label="Payments" />
            <Flag on={business.stripe_payouts_enabled} label="Payouts" />
          </div>
        ) : null}

        {requirements?.due.length ? (
          <div className="text-sm">
            <p className="font-medium">Stripe is asking for:</p>
            <ul className="mt-1 list-disc pl-5 text-zinc-600 dark:text-zinc-400">
              {requirements.due.slice(0, 8).map((r) => (
                <li key={r}>{r.replaceAll("_", " ").replaceAll(".", " › ")}</li>
              ))}
              {requirements.due.length > 8 ? <li>and {requirements.due.length - 8} more</li> : null}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {configured && status !== "active" ? (
            <ActionForm action={connectStripeAction}>
              <SubmitButton pendingLabel="Opening Stripe…">
                {status === "not_connected" ? "Connect Stripe" : "Continue onboarding"}
              </SubmitButton>
            </ActionForm>
          ) : null}
          {status === "active" ? (
            <a href="/coach/payments/setup/link" className="text-sm font-semibold text-brand hover:underline">Update business details</a>
          ) : null}
          {business.stripe_account_id ? (
            <>
              <a
                href="https://dashboard.stripe.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-brand hover:underline"
              >
                Open Stripe Dashboard ↗
              </a>
              <ActionButton action={refreshStripeStatusAction} fields={{}} variant="ghost" pendingLabel="Checking…">
                Refresh status
              </ActionButton>
            </>
          ) : null}
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <CardTitle>How it works</CardTitle>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your business is the seller: client receipts, card statements and the Stripe Dashboard are in your name.</li>
          <li>Stripe&apos;s processing fees are paid from your Stripe balance; refunds and disputes are handled in your account.</li>
          <li>
            {business.plan === "pro"
              ? "You're on the Pro plan: no platform fee on client payments."
              : `You're on the Starter plan: a ${feePercentLabel(business.platform_fee_bps)} platform fee is taken from each online payment.`}{" "}
            <Link href="/coach/payments/plan" className="font-semibold text-brand hover:underline">Change plan</Link>
          </li>
          <li>Packages, memberships and products sync to your Stripe account automatically.</li>
        </ul>
      </Card>
    </div>
  );
}
