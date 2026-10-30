import type { Metadata } from "next";
import { Check, Eyebrow, Panel, PLink, Section } from "../_components/ui";
import { FEATURE_GROUPS } from "./data";

export const metadata: Metadata = {
  title: "Features",
  description: "Booking, payments, programming, a client app, chat, form checks and lead funnels, all on your own brand.",
};

export default function FeaturesPage() {
  return (
    <>
      <Section className="pb-10 pt-14 sm:pt-20">
        <Eyebrow>Features</Eyebrow>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold sm:text-6xl">Everything your coaching business runs on.</h1>
        <p className="mt-5 max-w-2xl text-lg p-muted">
          One platform instead of a booking tool, a payments tool, a programming app, a chat app and a funnel builder. Every
          feature is included on every plan.
        </p>
        <nav aria-label="Feature areas" className="mt-8 flex flex-wrap gap-2">
          {FEATURE_GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="p-surface rounded-full border p-line px-3.5 py-1.5 text-sm font-medium hover:border-brand">
              <span aria-hidden>{g.icon}</span> {g.title}
            </a>
          ))}
        </nav>
      </Section>
      <Section className="grid gap-4 pb-20">
        {FEATURE_GROUPS.map((g) => (
          <Panel key={g.id} id={g.id} className="grid scroll-mt-24 gap-6 p-6 sm:p-8 md:grid-cols-[1fr_1.4fr]">
            <div>
              <span aria-hidden className="p-surface-2 flex size-12 items-center justify-center rounded-2xl text-2xl">
                {g.icon}
              </span>
              <h2 className="mt-4 text-2xl font-bold sm:text-3xl">{g.title}</h2>
              <p className="mt-2 p-muted">{g.summary}</p>
            </div>
            <ul className="grid gap-3 self-center">
              {g.points.map((p) => (
                <li key={p} className="flex gap-3 text-[15px]">
                  <Check className="mt-0.5" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </Section>
      <Section className="pb-24">
        <div className="p-ink rounded-3xl px-6 py-12 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">See it with your own brand on it.</h2>
          <p className="mx-auto mt-3 max-w-md opacity-75">Your site is live the moment you pick a name.</p>
          <div className="mt-6 flex justify-center gap-3">
            <PLink href="/start" size="lg" className="p-accent-bg hover:opacity-90">
              Start free
            </PLink>
          </div>
        </div>
      </Section>
    </>
  );
}
