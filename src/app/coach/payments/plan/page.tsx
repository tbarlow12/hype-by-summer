import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { ActionButton } from "@/components/payments/action-button";
import { Alert, Badge, Card, CardTitle, PageHeader, cn } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { feePercentLabel, proPriceCents } from "@/lib/payments/fees";
import { subscriptionRowFromStripe } from "@/lib/payments/mapping";
import { currentPlatformSubscription, proPrice, syncProCheckout } from "@/lib/payments/platform-billing";
import { loadBusiness } from "@/lib/payments/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/stripe";
import { managePlanBillingAction, switchToStarterAction, upgradeToProAction } from "./actions";

export const metadata = { title: "Plan" };

export default async function PlanPage({ searchParams }: PageProps<"/coach/payments/plan">) {
  let { business } = await requireManager();
  const sp = await searchParams;
  const configured = isStripeConfigured();
  if (configured && typeof sp.session_id === "string" && /^cs_[A-Za-z0-9_]+$/.test(sp.session_id)) {
    // Back from Pro checkout: apply it now instead of waiting for the webhook.
    try {
      await syncProCheckout(business.id, sp.session_id);
      business = await loadBusiness(createAdminClient(), business.id);
    } catch (err) {
      console.error("[plan] checkout sync failed", err);
    }
  }

  const [sub, price] = configured ? await Promise.all([currentPlatformSubscription(business).catch(() => null), proPrice()]) : [null, null];
  const subRow = sub ? subscriptionRowFromStripe(sub) : null;
  const pro = business.plan === "pro";
  const endingAt = pro && subRow?.cancel_at_period_end ? subRow.current_period_end : null;
  const proLabel = price ? `${formatMoney(price.cents, price.currency)} / ${price.interval}` : `${formatMoney(proPriceCents(process.env.PLATFORM_PRO_PRICE_DOLLARS))} / month`;
  const fee = feePercentLabel(business.platform_fee_bps);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/coach/payments" className="text-zinc-500 hover:text-brand">← Payments</Link>
      </p>
      <PageHeader title="Plan" description="Every feature is included on both plans. The plan only changes how you pay for the software." />

      {sp.upgraded ? (
        pro ? <Alert tone="green">Welcome to Pro. No platform fee applies to client payments from now on.</Alert>
          : <Alert tone="neutral">Your upgrade is processing. This page will show Pro once the payment is confirmed.</Alert>
      ) : null}
      {endingAt ? (
        <Alert tone="amber">Pro ends on {formatDate(endingAt, business.timezone)}; you&apos;ll move to Starter then.</Alert>
      ) : null}
      {pro && (business.platform_subscription_status === "past_due" || business.platform_subscription_status === "unpaid") ? (
        <Alert tone="red">Your last Pro payment failed. Update your card to stay on Pro.</Alert>
      ) : null}
      {!configured ? <Alert tone="amber">Billing isn&apos;t available right now.</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className={cn("flex flex-col gap-3", !pro && "ring-2 ring-brand")}>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Starter</CardTitle>
            {!pro ? <Badge tone="brand">Current plan</Badge> : null}
          </div>
          <p className="text-3xl font-black tracking-tight">$0<span className="ml-1 text-base font-medium text-zinc-500">/ month</span></p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            A {fee} platform fee on each online client payment, on top of Stripe&apos;s processing fees.
          </p>
          <div className="mt-auto">
            {pro && !endingAt && configured ? (
              <ActionButton
                action={switchToStarterAction}
                fields={{}}
                variant="outline"
                size="md"
                confirm="Switch to Starter at the end of your current Pro period?"
              >
                Switch to Starter
              </ActionButton>
            ) : null}
          </div>
        </Card>

        <Card className={cn("flex flex-col gap-3", pro && "ring-2 ring-brand")}>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Pro</CardTitle>
            {pro ? <Badge tone="brand">Current plan</Badge> : null}
          </div>
          <p className="text-3xl font-black tracking-tight">{proLabel}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No platform fee on client payments. Best once you take more than a few thousand dollars a month online.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            {configured && (!pro || endingAt) ? (
              <ActionForm action={upgradeToProAction}>
                <SubmitButton pendingLabel="Opening checkout…">{endingAt ? "Keep Pro" : "Upgrade to Pro"}</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </Card>
      </div>

      {business.platform_customer_id && configured ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Plan billing</CardTitle>
            <p className="mt-1 text-sm text-zinc-500">Update your card and download invoices for your plan.</p>
          </div>
          <ActionForm action={managePlanBillingAction}>
            <SubmitButton variant="outline" pendingLabel="Opening…">Manage billing</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
