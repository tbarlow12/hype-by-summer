import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, buttonClass, cn } from "@/components/ui";
import { CheckIcon, Section } from "@/components/marketing/sections";
import { getMembership, getProfile } from "@/lib/auth";
import { priceLabel } from "@/lib/payments/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusiness, requireBusiness } from "@/lib/tenant";
import type { Tables } from "@/lib/supabase/database.types";

export async function generateMetadata(): Promise<Metadata> {
  const business = await getBusiness();
  return {
    title: "Pricing",
    description: business ? `Session packs, memberships and programs from ${business.name}.` : undefined,
  };
}

type Offering = Tables<"offerings">;

const GROUPS: { kind: Offering["kind"]; eyebrow: string; title: string; intro: string; cta: string }[] = [
  {
    kind: "subscription",
    eyebrow: "Memberships",
    title: "Ongoing coaching",
    intro: "Consistent support, billed automatically. Cancel any time before your next renewal.",
    cta: "Join",
  },
  {
    kind: "package",
    eyebrow: "Session packs",
    title: "Save with a pack",
    intro: "Buy sessions up front and book them whenever it suits you.",
    cta: "Buy pack",
  },
  {
    kind: "one_time",
    eyebrow: "Programs & extras",
    title: "Train on your own terms",
    intro: "Downloadable programs and one-off services.",
    cta: "Buy now",
  },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const business = await requireBusiness();
  const { error } = await searchParams;
  const [profile, membership] = await Promise.all([getProfile(), getMembership()]);
  // Public page: service role, always scoped to the business this site belongs to.
  const admin = createAdminClient();
  const [{ data: offerings }, { data: sessionTypes }] = await Promise.all([
    admin
      .from("offerings")
      .select("id, kind, name, description, features, price_cents, currency, billing_interval, interval_count, trial_days, credits, credits_expire_days, session_type_ids, includes_messaging, includes_programming, featured, sort_order, digital_file_path")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("sort_order")
      .order("price_cents"),
    admin.from("session_types").select("id, name").eq("business_id", business.id),
  ]);
  const typeNames = new Map((sessionTypes ?? []).map((s) => [s.id, s.name]));
  const isStaff = Boolean(membership);
  const canSell = Boolean(business.stripe_account_id && business.stripe_charges_enabled);

  return (
    <>
      <Section
        eyebrow="Pricing"
        title="Find the right fit"
        intro={
          <>
            Single sessions can always be booked directly.{" "}
            <Link href="/book" className="font-semibold text-brand hover:underline">
              See the booking calendar →
            </Link>
          </>
        }
        className="pb-0 sm:pb-0"
      >
        {typeof error === "string" ? (
          <div className="mb-6">
            <Alert tone="red">{error}</Alert>
          </div>
        ) : null}
        {isStaff ? (
          <div className="mb-6">
            <Alert tone="amber">
              You&apos;re signed in as staff. This is how clients see your offerings.{" "}
              <Link href="/coach/offerings" className="font-semibold underline">Manage offerings</Link>
              {!canSell ? (
                <>
                  {" "}Online checkout is off until Stripe is connected:{" "}
                  <Link href="/coach/payments/setup" className="font-semibold underline">Set up payments</Link>
                </>
              ) : null}
            </Alert>
          </div>
        ) : null}
        {!offerings?.length ? (
          <Card className="p-8 text-center">
            <p className="font-semibold">Packages and memberships are coming soon.</p>
            <p className="mt-1 text-sm text-zinc-500">In the meantime, book a session or a free consult and we&apos;ll find the right fit together.</p>
            <Link href="/book" className={buttonClass("primary", "md", "mt-4")}>
              Book a session
            </Link>
          </Card>
        ) : null}
      </Section>

      {GROUPS.map((g, gi) => {
        const items = (offerings ?? []).filter((o) => o.kind === g.kind);
        if (!items.length) return null;
        return (
          <Section key={g.kind} id={g.kind} eyebrow={g.eyebrow} title={g.title} intro={g.intro} tone={gi % 2 ? "muted" : "light"}>
            <div className={cn("grid gap-6", items.length >= 3 ? "md:grid-cols-2 lg:grid-cols-3" : items.length === 2 ? "md:grid-cols-2" : "max-w-md")}>
              {items.map((o) => {
                const perks = [
                  o.credits > 0
                    ? `${o.credits} session credit${o.credits === 1 ? "" : "s"}${o.kind === "subscription" ? " every period" : ""}${
                        o.session_type_ids?.length ? ` (${o.session_type_ids.map((id) => typeNames.get(id)).filter(Boolean).join(", ")})` : ""
                      }`
                    : null,
                  o.credits > 0 && o.credits_expire_days ? `Credits valid for ${o.credits_expire_days} days` : null,
                  o.kind === "subscription" && o.trial_days > 0 ? `${o.trial_days}-day free trial` : null,
                  o.includes_programming ? "Personalized training program" : null,
                  o.includes_messaging && o.kind !== "one_time" ? "Message your coach any time" : null,
                  o.kind === "one_time" && o.digital_file_path ? "Instant download" : null,
                  ...o.features,
                ].filter((x): x is string => Boolean(x));
                return (
                  <Card
                    key={o.id}
                    className={cn(
                      "relative flex flex-col gap-4 p-6",
                      o.featured && "border-brand ring-2 ring-brand shadow-lg",
                    )}
                  >
                    {o.featured ? (
                      <Badge tone="brand" className="absolute -top-3 left-6 bg-brand text-on-brand">
                        Most popular
                      </Badge>
                    ) : null}
                    <div>
                      <h3 className="text-xl font-bold tracking-tight">{o.name}</h3>
                      {o.description ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{o.description}</p> : null}
                    </div>
                    <p className="text-4xl font-black tracking-tight">
                      {priceLabel({ ...o, billing_interval: null })}
                      {o.kind === "subscription" && o.billing_interval ? (
                        <span className="ml-1 text-base font-medium text-zinc-500">
                          / {o.interval_count > 1 ? `${o.interval_count} ${o.billing_interval}s` : o.billing_interval}
                        </span>
                      ) : null}
                    </p>
                    {o.kind === "package" && o.credits > 1 ? (
                      <p className="-mt-3 text-sm text-zinc-500">
                        {priceLabel({ ...o, kind: "package", price_cents: Math.round(o.price_cents / o.credits) })} per session
                      </p>
                    ) : null}
                    {perks.length ? (
                      <ul className="flex flex-col gap-2 text-sm">
                        {perks.map((p, i) => (
                          <li key={i} className="flex gap-2">
                            <CheckIcon />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-auto pt-2">
                      {canSell ? (
                        <>
                          {/* Plain anchor: this hits a route handler that starts checkout (no prefetch). */}
                          <a
                            href={`/checkout/start?offering=${o.id}`}
                            className={buttonClass(o.featured ? "primary" : "secondary", "lg", "w-full")}
                          >
                            {o.kind === "subscription" && o.trial_days > 0 ? "Start free trial" : g.cta}
                          </a>
                          {!profile ? <p className="mt-2 text-center text-xs text-zinc-500">You&apos;ll create a free account first.</p> : null}
                        </>
                      ) : (
                        <p className="text-center text-sm text-zinc-500">Online checkout opens soon.</p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </Section>
        );
      })}

      <Section tone="muted" className="py-12 sm:py-16">
        <div className="grid gap-6 text-sm text-zinc-600 md:grid-cols-3 dark:text-zinc-400">
          <div>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Secure checkout</p>
            <p className="mt-1">Payments are processed by Stripe. Card details never touch our servers.</p>
          </div>
          <div>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Use credits any time</p>
            <p className="mt-1">Credits appear in your account right away and apply automatically when you book.</p>
          </div>
          <div>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Manage your plan</p>
            <p className="mt-1">Cancel or update your payment method from Billing in your account.</p>
          </div>
        </div>
      </Section>
    </>
  );
}
