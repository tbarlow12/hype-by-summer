import type { Metadata } from "next";
import { PLATFORM_DOMAIN, PLATFORM_NAME } from "@/lib/platform";
import { breakEvenCents, formatBps, formatDollars, planPricing } from "./plans";
import { Check, Eyebrow, Panel, PLink, Section } from "./_components/ui";
import { ProductPreview } from "./_components/product-preview";
import { FEATURE_GROUPS } from "./features/data";

export const metadata: Metadata = { title: { absolute: `${PLATFORM_NAME}: run your training business on your own brand` } };

const exampleHost = `yourname.${PLATFORM_DOMAIN.replace(/:\d+$/, "")}`;

export default function PlatformHome() {
  const pricing = planPricing();
  const breakEven = breakEvenCents(pricing);
  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div aria-hidden className="p-grid absolute inset-0" />
        <Section className="relative grid items-center gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-24">
          <div>
            <p className="p-surface inline-flex items-center gap-2 rounded-full border p-line px-3 py-1 text-xs font-medium">
              <span className="p-accent-bg rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">New</span>
              For personal trainers &amp; studios
            </p>
            <h1 className="mt-5 text-[2.6rem] font-bold sm:text-6xl">
              Your training business.
              <br />
              <span className="text-brand">Your brand</span> on every screen.
            </h1>
            <p className="mt-5 max-w-xl text-lg p-muted">
              Booking, payments, programs, a client app, chat and lead funnels in one place, under your name and your
              domain. Your clients never see ours.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PLink href="/start" size="lg">
                Start free
                <span aria-hidden>→</span>
              </PLink>
              <PLink href="/features" size="lg" variant="outline">
                See everything it does
              </PLink>
            </div>
            <p className="mt-4 text-sm p-muted">
              $0/month to start. No card needed. Live at <span className="font-mono text-[0.95em]">{exampleHost}</span> in minutes.
            </p>
          </div>
          <ProductPreview />
        </Section>
      </div>

      {/* What you replace */}
      <div className="border-y p-line p-surface">
        <Section className="grid gap-6 py-10 sm:grid-cols-3">
          {[
            ["One login", "for booking, payments, programming, messaging and marketing. Not six apps glued together."],
            ["One brand", "yours: your logo, colors and domain on the site, the client app, emails and texts."],
            ["One price", `that grows with you: ${formatBps(pricing.starterFeeBps)} of what you collect, or a flat ${formatDollars(pricing.proMonthlyCents)}/month.`],
          ].map(([title, body]) => (
            <p key={title} className="text-[15px] p-muted">
              <span className="font-display text-lg font-bold text-[var(--foreground)]">{title}</span> {body}
            </p>
          ))}
        </Section>
      </div>

      {/* Feature grid */}
      <Section className="py-20 sm:py-24">
        <Eyebrow>Everything in one place</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold sm:text-5xl">Built for how coaches actually work.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURE_GROUPS.map((g) => (
            <Panel key={g.id} className="flex flex-col p-6">
              <span aria-hidden className="p-surface-2 flex size-11 items-center justify-center rounded-2xl text-xl">
                {g.icon}
              </span>
              <h3 className="mt-5 text-xl font-bold">{g.title}</h3>
              <p className="mt-2 text-sm p-muted">{g.summary}</p>
            </Panel>
          ))}
        </div>
        <div className="mt-8">
          <PLink href="/features" variant="ghost">
            Explore every feature <span aria-hidden>→</span>
          </PLink>
        </div>
      </Section>

      {/* White label */}
      <div className="p-ink">
        <Section className="grid gap-12 py-20 sm:py-24 lg:grid-cols-2">
          <div>
            <p className="p-accent text-xs font-semibold uppercase tracking-[0.18em]">White-label, top to bottom</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-5xl">It&apos;s your business. It should look like it.</h2>
            <p className="mt-5 max-w-lg text-lg opacity-75">
              Clients book on your site, pay you directly, train in your app and get emails and texts from your name. We stay
              out of the way.
            </p>
          </div>
          <ul className="grid gap-4 self-center sm:grid-cols-2">
            {[
              ["Your domain", `Start on ${exampleHost}, then connect yourstudio.com. SSL is automatic.`],
              ["Your look", "Logo, brand color and type style across the site, client app, emails and receipts."],
              ["Your Stripe", "Payments land in your own Stripe account. Payouts on your schedule."],
              ["Your clients", "Your list, your data. Export anytime. We never market to your clients."],
            ].map(([title, body]) => (
              <li key={title} className="rounded-2xl border border-current/15 p-5">
                <p className="font-display text-lg font-bold">{title}</p>
                <p className="mt-1.5 text-sm opacity-70">{body}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* How it works */}
      <Section className="py-20 sm:py-24">
        <Eyebrow>Up and running today</Eyebrow>
        <h2 className="mt-3 text-3xl font-bold sm:text-5xl">Three steps to your first booking.</h2>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            ["Claim your address", "Pick your business name and web address. We set up a free consult and a 1:1 session to start from."],
            ["Connect Stripe", "Link your Stripe account in a few minutes to take cards, sell packs and run memberships."],
            ["Share your link", "Put it in your bio. New clients book, pay and get their plan, all on your brand."],
          ].map(([title, body], i) => (
            <li key={title}>
              <Panel className="h-full p-6">
                <span className="font-display text-5xl font-bold text-brand">{i + 1}</span>
                <h3 className="mt-4 text-xl font-bold">{title}</h3>
                <p className="mt-2 text-sm p-muted">{body}</p>
              </Panel>
            </li>
          ))}
        </ol>
      </Section>

      {/* Pricing teaser */}
      <Section className="pb-20 sm:pb-24">
        <Panel className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <Eyebrow>Simple pricing</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Every feature on every plan.</h2>
            <p className="mt-3 max-w-lg p-muted">
              Start at $0 a month and pay {formatBps(pricing.starterFeeBps)} only when your clients pay you. Switch to Pro for a
              flat {formatDollars(pricing.proMonthlyCents)}/month and keep 100%
              {breakEven ? <> (worth it past about {formatDollars(Math.ceil(breakEven / 100) * 100)} a month in client payments)</> : null}.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <PLink href="/pricing">Compare plans</PLink>
              <PLink href="/start" variant="outline">
                Start free
              </PLink>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-surface-2 rounded-2xl p-5">
              <p className="text-sm font-semibold">Starter</p>
              <p className="mt-2 font-display text-4xl font-bold">$0</p>
              <p className="text-sm p-muted">/month + {formatBps(pricing.starterFeeBps)}</p>
            </div>
            <div className="p-ink rounded-2xl p-5">
              <p className="text-sm font-semibold">Pro</p>
              <p className="mt-2 font-display text-4xl font-bold">{formatDollars(pricing.proMonthlyCents)}</p>
              <p className="text-sm opacity-70">/month, 0% fee</p>
            </div>
          </div>
        </Panel>
      </Section>

      {/* FAQ */}
      <Section className="pb-20 sm:pb-24">
        <h2 className="text-3xl font-bold sm:text-4xl">Questions</h2>
        <div className="mt-8 grid gap-3 lg:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-surface rounded-2xl border p-line p-5 open:pb-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="text-xl transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm p-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Final CTA */}
      <Section className="pb-24">
        <div className="p-ink relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold sm:text-5xl">Give your clients an app with your name on it.</h2>
          <p className="mx-auto mt-4 max-w-lg opacity-75">Set up in minutes. Free until your clients pay you.</p>
          <div className="mt-8 flex justify-center">
            <PLink href="/start" size="lg" className="p-accent-bg hover:opacity-90">
              Start free <span aria-hidden>→</span>
            </PLink>
          </div>
          <ul className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm opacity-80">
            {["No card to start", "Cancel anytime", "Your data, exportable"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="p-accent" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}

const FAQ: [string, string][] = [
  [
    "Will my clients see your name anywhere?",
    "No. Your site, client app, emails, texts and receipts all carry your business name, logo and colors. On your own domain there's nothing pointing back to us.",
  ],
  [
    "How do I get paid?",
    "You connect your own Stripe account. Client payments go straight to it and Stripe pays out to your bank. On Starter the platform fee is taken automatically from each payment; on Pro there is none.",
  ],
  [
    "Can I use my own domain?",
    "Yes, on both plans. You start on a free subdomain and can connect a domain you own whenever you like. We handle SSL.",
  ],
  [
    "I have a team. Does that work?",
    "Yes. Invite coaches and staff, give each their own calendar, availability and clients, and see everyone's schedule and revenue as the owner.",
  ],
  [
    "Can I move my existing clients over?",
    "Invite them by email from the clients page. They set up their account in a tap and land in your branded app.",
  ],
  [
    "What does Stripe charge?",
    "Stripe's standard card processing fees apply on both plans and go to Stripe, not us. Our fee (Starter) or subscription (Pro) is separate and shown clearly.",
  ],
];
