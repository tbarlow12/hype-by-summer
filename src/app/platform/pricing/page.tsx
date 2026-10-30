import type { Metadata } from "next";
import { Check, Eyebrow, PLink, Section } from "../_components/ui";
import { breakEvenCents, formatBps, formatDollars, planPricing } from "../plans";
import { PlanCalculator } from "./calculator";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free and pay a small fee only when clients pay you, or pay one flat monthly price. Every feature on both plans.",
};

const EVERYTHING = [
  "Your branded site + client app",
  "Your own domain",
  "Unlimited clients and bookings",
  "Packs, memberships and products",
  "Program builder and workout logging",
  "Chat, form checks and video sessions",
  "Lead funnels and CRM",
  "Email and text reminders",
  "Team members and roles",
];

export default function PricingPage() {
  const pricing = planPricing();
  const fee = formatBps(pricing.starterFeeBps);
  const pro = formatDollars(pricing.proMonthlyCents);
  const breakEven = breakEvenCents(pricing);
  return (
    <>
      <Section className="pb-12 pt-14 text-center sm:pt-20">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold sm:text-6xl">Two plans. Every feature on both.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg p-muted">
          The only difference is how you pay us: a small share of what you collect, or one flat monthly price.
        </p>
      </Section>

      <Section className="grid gap-4 pb-16 md:grid-cols-2">
        <div className="p-surface flex flex-col rounded-3xl border p-line p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Starter</h2>
          <p className="mt-1 p-muted">For getting started and growing.</p>
          <p className="mt-6 flex items-baseline gap-2">
            <span className="font-display text-6xl font-bold">$0</span>
            <span className="p-muted">/month</span>
          </p>
          <p className="mt-1 font-semibold">+ {fee} of each client payment</p>
          <p className="mt-4 text-sm p-muted">
            Nothing to pay until your clients pay you. The fee comes out of each payment automatically, so there&apos;s no bill.
          </p>
          <PLink href="/start" size="lg" className="mt-8">
            Start free
          </PLink>
        </div>
        <div className="p-ink relative flex flex-col rounded-3xl p-6 sm:p-8">
          <span className="p-accent-bg absolute right-6 top-6 rounded-full px-2.5 py-1 text-xs font-bold">0% platform fee</span>
          <h2 className="text-2xl font-bold">Pro</h2>
          <p className="mt-1 opacity-70">For established businesses.</p>
          <p className="mt-6 flex items-baseline gap-2">
            <span className="font-display text-6xl font-bold">{pro}</span>
            <span className="opacity-70">/month</span>
          </p>
          <p className="mt-1 font-semibold">Keep 100% of client payments</p>
          <p className="mt-4 text-sm opacity-70">
            {breakEven
              ? `Saves you money once clients pay you more than about ${formatDollars(Math.ceil(breakEven / 100) * 100)} a month.`
              : "A flat monthly price."}{" "}
            Switch between plans anytime.
          </p>
          <PLink href="/start" size="lg" className="p-accent-bg mt-8 hover:opacity-90">
            Start free, upgrade later
          </PLink>
        </div>
      </Section>

      <Section className="grid gap-10 pb-20 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div>
          <h2 className="text-3xl font-bold">Included on both plans</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {EVERYTHING.map((f) => (
              <li key={f} className="flex gap-3 text-[15px]">
                <Check className="mt-0.5" /> {f}
              </li>
            ))}
          </ul>
        </div>
        <PlanCalculator pricing={pricing} />
      </Section>

      <Section className="pb-24">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["What about Stripe's fees?", "Card processing fees are Stripe's standard rates, paid to Stripe on both plans. Our fee is separate."],
            ["When do I pay for Pro?", "Monthly, by card, starting the day you switch. Cancel or switch back to Starter anytime."],
            ["Are there limits?", "No caps on clients, bookings, programs or messages on either plan."],
          ].map(([q, a]) => (
            <div key={q} className="rounded-2xl border p-line p-5">
              <p className="font-semibold">{q}</p>
              <p className="mt-2 text-sm p-muted">{a}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
