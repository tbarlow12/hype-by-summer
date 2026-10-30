import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, LinkButton, buttonClass } from "@/components/ui";
import { LeadMagnetForm } from "@/components/lead-magnet-form";
import { ContactForm } from "@/components/marketing/contact-form";
import { CheckIcon, GuideCover, LOCATION_LABELS, Section, Stars } from "@/components/marketing/sections";
import { notFound } from "next/navigation";
import { BRAND_NAME, SITE_URL } from "@/lib/env";
import { PLATFORM_NAME } from "@/lib/platform";
import { formatDuration, formatMoney } from "@/lib/format";
import { coachName, consultHref, getApprovedTestimonials, getSiteContext } from "@/lib/marketing";

export async function generateMetadata(): Promise<Metadata> {
  const { magnets, trainer } = await getSiteContext();
  if (!trainer) return { title: PLATFORM_NAME };
  const description =
    trainer.bio?.slice(0, 160) ??
    `Personal training and online coaching with ${coachName(trainer).full}. Book a free consult today.`;
  const image = trainer.cover_image_url ?? trainer.profiles?.avatar_url ?? magnets[0]?.cover_image_url ?? undefined;
  return {
    title: { absolute: trainer.headline ? `${BRAND_NAME} · ${trainer.headline}` : `${BRAND_NAME} · Personal training` },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title: trainer.headline ?? BRAND_NAME,
      description,
      url: "/",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function HomePage() {
  const { magnets, types, trainer } = await getSiteContext();
  if (!trainer) notFound();

  const testimonials = await getApprovedTestimonials(trainer.trainer_id);
  const { full: name, first } = coachName(trainer);
  const consult = consultHref(trainer, types);
  const consultType = types.find((t) => t.is_consultation);
  const services = types.filter((t) => !t.is_consultation);
  const magnet = magnets[0];
  const guideHref = magnet ? "#free-guide" : "/free";
  const rated = testimonials.filter((t) => t.rating);
  const avgRating = rated.length ? rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length : null;
  const portrait = trainer.profiles?.avatar_url ?? null;
  const bioParagraphs = (trainer.bio ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const where = trainer.default_location ?? "In person & online";

  const formats = new Set(types.map((t) => t.location_type)).size;
  const heroStats: { label: string; value: string; suffix?: string }[] = [
    avgRating
      ? { label: "Client rating", value: avgRating.toFixed(1), suffix: "/ 5" }
      : { label: "First step", value: "Free", suffix: "consult" },
    ...(formats ? [{ label: "Formats", value: String(formats), suffix: formats === 1 ? "way to train" : "ways to train" }] : []),
    ...(trainer.certifications.length
      ? [{ label: "Certified", value: String(trainer.certifications.length), suffix: trainer.certifications.length === 1 ? "cert" : "certs" }]
      : []),
  ];

  const faqs: { q: string; a: string }[] = [
    {
      q: "I'm a total beginner. Is this for me?",
      a: "Absolutely. Every plan starts from where you are today. We'll build the basics, learn proper form and progress at a pace that feels challenging but doable.",
    },
    {
      q: "Where do sessions happen?",
      a: `${where}. Online sessions run over live video and you'll get a link right after booking. Prefer to train on your own? App-based coaching gives you a custom program with check-ins and form reviews.`,
    },
    {
      q: "What happens on the free consult?",
      a: `It's a relaxed ${consultType ? formatDuration(consultType.duration_minutes) : "short"} chat about your goals, schedule, training history and any injuries. You'll leave with clear next steps, whether or not we end up working together.`,
    },
    {
      q: "What's your cancellation policy?",
      a:
        trainer.cancellation_window_hours > 0
          ? `Life happens. Reschedule or cancel up to ${trainer.cancellation_window_hours} hours before a session at no charge${trainer.refund_on_cancel ? " and you'll be refunded or get your session credit back" : ""}. Late cancellations and no-shows may be charged.`
          : "You can reschedule or cancel from the link in your confirmation email.",
    },
    {
      q: "How do packages and memberships work?",
      a: "Buy a session pack or a monthly membership and your sessions are added to your account as credits. Book any time from your client portal and credits are used automatically.",
    },
    {
      q: "Do I get support between sessions?",
      a: "Yes. Clients get the app with their program, workout logging, progress tracking, form-check videos and direct messaging with me.",
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: trainer.business_name,
    description: trainer.headline ?? undefined,
    url: SITE_URL,
    image: trainer.cover_image_url ?? portrait ?? undefined,
    founder: { "@type": "Person", name },
    ...(avgRating && rated.length
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: avgRating.toFixed(1), reviewCount: rated.length } }
      : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-zinc-950 px-4 pb-20 pt-16 text-white sm:px-6 sm:pb-28 sm:pt-24">
        {trainer.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={trainer.cover_image_url} alt="" className="absolute inset-0 -z-20 size-full object-cover opacity-30" />
        ) : null}
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,rgba(225,29,72,0.55),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(225,29,72,0.25),transparent_50%)]"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {trainer.accepting_new_clients ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
                  <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                  Now accepting new clients
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20">Waitlist open</span>
              )}
              <span className="text-xs font-medium text-zinc-300">{where}</span>
            </div>
            <h1 className="mt-6 text-5xl font-black leading-[0.95] tracking-tight text-balance sm:text-7xl">
              {trainer.headline ?? (
                <>
                  Stronger body. <span className="text-rose-400">Unshakable</span> confidence.
                </>
              )}
            </h1>
            <p className="mt-6 max-w-xl text-lg text-zinc-300 sm:text-xl">
              {bioParagraphs[0]?.slice(0, 240) ??
                `Coaching with ${name}: personal training and online programs built around your goals, your schedule and your life.`}
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <LinkButton href={consult} size="lg" className="shadow-lg shadow-brand/30">
                Book a free consult
              </LinkButton>
              <Link href={guideHref} className={buttonClass("inverse", "lg")}>
                Get the free guide
              </Link>
            </div>
            {heroStats.length ? (
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-8">
                {heroStats.map((stat) => (
                  <div key={stat.label}>
                    <dt className="text-xs uppercase tracking-wide text-zinc-300">{stat.label}</dt>
                    <dd className="mt-1 text-2xl font-black">
                      {stat.value}
                      {stat.suffix ? <span className="ml-1 text-sm font-medium text-zinc-300">{stat.suffix}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            {portrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={portrait} alt={`${name}, coach`} className="aspect-[4/5] w-full rounded-[2rem] object-cover shadow-2xl ring-1 ring-white/10" />
            ) : (
              <div className="flex aspect-[4/5] w-full items-end rounded-[2rem] bg-gradient-to-br from-brand to-zinc-900 p-8 shadow-2xl ring-1 ring-white/10">
                <p className="text-6xl font-black leading-none tracking-tight text-white/90">
                  Train
                  <br />
                  with
                  <br />
                  {first}.
                </p>
              </div>
            )}
            {testimonials[0] ? (
              <figure className="absolute -bottom-8 -left-4 max-w-[16rem] rounded-2xl bg-white p-4 text-zinc-900 shadow-xl sm:-left-10">
                {testimonials[0].rating ? <Stars rating={testimonials[0].rating} /> : null}
                <blockquote className="mt-1 line-clamp-3 text-sm font-medium">&ldquo;{testimonials[0].body}&rdquo;</blockquote>
                <figcaption className="mt-2 text-xs text-zinc-500">{testimonials[0].author_name}</figcaption>
              </figure>
            ) : null}
          </div>
        </div>
      </section>

      {/* Featured lead magnet */}
      {magnet ? (
        <section id="free-guide" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-zinc-200 bg-gradient-to-br from-rose-50 via-white to-white shadow-sm dark:border-zinc-800 dark:from-rose-950/40 dark:via-zinc-950 dark:to-zinc-950">
            <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[0.8fr_1.2fr] lg:p-14">
              <div className="mx-auto w-full max-w-xs lg:max-w-none">
                <GuideCover title={magnet.title} src={magnet.cover_image_url} className="-rotate-2" />
              </div>
              <div>
                <Badge tone="brand">Free download</Badge>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-balance sm:text-4xl">{magnet.title}</h2>
                {magnet.subtitle ? <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">{magnet.subtitle}</p> : null}
                {magnet.bullet_points.length ? (
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {magnet.bullet_points.map((b) => (
                      <li key={b} className="flex gap-2 text-sm font-medium">
                        <CheckIcon />
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-8">
                  <LeadMagnetForm magnet={{ id: magnet.id, cta_label: magnet.cta_label, ask_phone: magnet.ask_phone, ask_goal: magnet.ask_goal }} compact />
                </div>
                {magnets.length > 1 ? (
                  <p className="mt-4 text-sm text-zinc-500">
                    Looking for something else?{" "}
                    <Link href="/free" className="font-semibold text-brand hover:underline">
                      See all free guides
                    </Link>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Services */}
      <Section
        id="services"
        eyebrow="Ways to train"
        title="Coaching that fits your life"
        intro="One-on-one, small group or fully online. Pick what works today and switch whenever you need to."
        tone="muted"
      >
        {services.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <Card key={s.id} className="flex flex-col p-6 transition-shadow hover:shadow-lg">
                <div className="flex items-center justify-between gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                  <Badge>{LOCATION_LABELS[s.location_type] ?? s.location_type}</Badge>
                </div>
                <h3 className="mt-4 text-xl font-bold tracking-tight">{s.name}</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {formatDuration(s.duration_minutes)}
                  {s.capacity > 1 ? ` · small group (up to ${s.capacity})` : " · 1:1"}
                </p>
                {s.description ? <p className="mt-3 flex-1 text-sm text-zinc-600 dark:text-zinc-400">{s.description}</p> : <div className="flex-1" />}
                <div className="mt-6 flex items-end justify-between gap-3">
                  <p className="text-3xl font-black tracking-tight">
                    {s.price_cents > 0 ? formatMoney(s.price_cents, s.currency) : "Free"}
                    {s.price_cents > 0 ? <span className="ml-1 text-sm font-medium text-zinc-500">/ session</span> : null}
                  </p>
                  <LinkButton href={`/book/${trainer.slug}/${s.slug}`} variant="secondary" size="sm">
                    Book
                  </LinkButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="font-semibold">Session options are being finalized.</p>
            <p className="mt-1 text-sm text-zinc-500">Book a free consult and we&apos;ll find the right fit together.</p>
          </Card>
        )}
        <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
          Save with session packs and monthly memberships.{" "}
          <Link href="/pricing" className="font-semibold text-brand hover:underline">
            See pricing →
          </Link>
        </p>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" eyebrow="How it works" title="From first chat to real results">
        <ol className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Book a free consult",
              body: `A no-pressure ${consultType ? formatDuration(consultType.duration_minutes) : ""} call to talk goals, schedule, history and anything holding you back.`,
            },
            {
              title: "Get your plan",
              body: "A program built for your body, equipment and calendar, with nutrition habits you can actually stick to.",
            },
            {
              title: "Train, track, progress",
              body: "Sessions in person or online, workouts in the app, weekly check-ins and form feedback so you keep moving forward.",
            },
          ].map((step, i) => (
            <li key={step.title} className="relative rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
              <span aria-hidden="true" className="text-6xl font-black leading-none text-brand/20">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-4 text-xl font-bold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.body.replace(/\s+/g, " ")}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <LinkButton href={consult} size="lg">
            Start with a free consult
          </LinkButton>
        </div>
      </Section>

      {/* Testimonials */}
      {testimonials.length ? (
        <Section
          id="results"
          eyebrow="Client love"
          title="Real people. Real results."
          tone="dark"
          intro={avgRating ? `Rated ${avgRating.toFixed(1)} out of 5 by ${rated.length} client${rated.length === 1 ? "" : "s"}.` : undefined}
        >
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
            {testimonials.map((t) => (
              <figure key={t.id} className="mb-5 break-inside-avoid rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                {t.rating ? <Stars rating={t.rating} /> : null}
                <blockquote className="mt-3 text-zinc-100">&ldquo;{t.body}&rdquo;</blockquote>
                <figcaption className="mt-4 text-sm font-semibold text-zinc-300">{t.author_name}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Coach bio */}
      <Section id="coach" tone="muted">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1.4fr]">
          {portrait ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={portrait} alt={name} className="aspect-square w-full max-w-md rounded-[2rem] object-cover shadow-lg" />
          ) : (
            <div className="flex aspect-square w-full max-w-md items-center justify-center rounded-[2rem] bg-brand/10 text-8xl font-black text-brand">
              {first.charAt(0)}
            </div>
          )}
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Meet your coach</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Hi, I&apos;m {first}.</h2>
            <div className="mt-6 space-y-4 text-lg text-zinc-700 dark:text-zinc-300">
              {bioParagraphs.length ? (
                bioParagraphs.map((p) => <p key={p.slice(0, 40)}>{p}</p>)
              ) : (
                <p>
                  I help busy people get stronger, move better and build habits that last, without living in the gym or
                  following a diet they hate.
                </p>
              )}
            </div>
            {trainer.specialties.length ? (
              <div className="mt-8">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Specialties</h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {trainer.specialties.map((s) => (
                    <li key={s} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {trainer.certifications.length ? (
              <div className="mt-8">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Certifications</h3>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {trainer.certifications.map((c) => (
                    <li key={c} className="flex gap-2 text-sm font-medium">
                      <CheckIcon />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Questions, answered">
        <div className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {faqs.map((f) => (
            <details key={f.q} className="group p-5 sm:p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="text-2xl leading-none text-brand transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 text-zinc-600 dark:text-zinc-400">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="px-4 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-brand px-6 py-14 text-center text-on-brand sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.25),transparent_45%)]" aria-hidden="true" />
          <h2 className="relative text-4xl font-black tracking-tight text-balance sm:text-6xl">Your strongest era starts now.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-white">
            Book a free consult with {first}. No pressure, no commitment, just a plan.
          </p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={consult} className={buttonClass("white", "lg")}>
              Book a free consult
            </Link>
            <Link href="#contact" className={buttonClass("inverse", "lg")}>
              Ask a question
            </Link>
          </div>
        </div>
      </section>

      {/* Contact */}
      <Section id="contact" eyebrow="Contact" title="Let's talk" intro="Tell me about your goals and I'll get back to you within one business day.">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
          <Card className="p-6 sm:p-8">
            <ContactForm />
          </Card>
          <div className="space-y-6 text-sm">
            <div>
              <h3 className="font-semibold">Prefer to jump straight in?</h3>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">Pick a time that works for you. The consult is free.</p>
              <LinkButton href={consult} className="mt-3">
                Book a free consult
              </LinkButton>
            </div>
            <div>
              <h3 className="font-semibold">Where</h3>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{where}</p>
            </div>
            {trainer.instagram_handle ? (
              <div>
                <h3 className="font-semibold">Instagram</h3>
                <a
                  href={`https://instagram.com/${trainer.instagram_handle.replace(/^@/, "")}`}
                  className="mt-1 inline-block text-brand hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{trainer.instagram_handle.replace(/^@/, "")}
                </a>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold">Already a client?</h3>
              <Link href="/login" className="mt-1 inline-block text-brand hover:underline">
                Sign in to your portal →
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
