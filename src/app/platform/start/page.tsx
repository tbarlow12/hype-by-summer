import Link from "next/link";
import type { Metadata } from "next";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessUrl } from "@/lib/tenant";
import { PLATFORM_DOMAIN, PLATFORM_NAME, tenantHost } from "@/lib/platform";
import { SignupForm } from "@/app/(auth)/signup/signup-form";
import { Check, Panel, PLink, Section } from "../_components/ui";
import { formatBps, planPricing } from "../plans";
import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "Start your business" };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", staff: "Staff" };

export default async function StartPage() {
  const profile = await getProfile();
  const domain = PLATFORM_DOMAIN;
  const fee = formatBps(planPricing().starterFeeBps);

  if (!profile) {
    return (
      <Section className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_minmax(0,440px)] lg:items-start">
        <Intro step={1} fee={fee} />
        <Panel className="p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Create your account</h2>
          <p className="mb-6 mt-1 text-sm p-muted">Step 1 of 2. Next you&apos;ll name your business and pick your address.</p>
          <SignupForm next="/start" askPhone={false} submitLabel="Create account" />
          <p className="mt-6 text-center text-sm p-muted">
            Already have an account?{" "}
            <Link href="/login?next=%2Fstart" className="font-semibold text-brand">
              Sign in
            </Link>
          </p>
        </Panel>
      </Section>
    );
  }

  const { data: memberships } = await createAdminClient()
    .from("business_members")
    .select("role, businesses!inner(id, name, slug, custom_domain, domain_verified_at, status, brand_color)")
    .eq("user_id", profile.id)
    .eq("active", true)
    .order("created_at");
  const mine = (memberships ?? []).filter((m) => m.businesses.status === "active");

  return (
    <Section className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[1fr_minmax(0,520px)] lg:items-start">
      <div className="grid gap-8">
        <Intro step={2} fee={fee} hasBusiness={mine.length > 0} />
        {mine.length ? (
          <div>
            <h2 className="text-xl font-bold">Your businesses</h2>
            <ul className="mt-4 grid gap-3">
              {mine.map((m) => {
                const b = m.businesses;
                return (
                  <li key={b.id}>
                    <Panel className="flex flex-wrap items-center gap-4 p-4">
                      <span aria-hidden className="size-10 shrink-0 rounded-xl" style={{ background: b.brand_color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{b.name}</p>
                        <p className="truncate text-sm p-muted">
                          {tenantHost(b)} · {ROLE_LABEL[m.role] ?? m.role}
                        </p>
                      </div>
                      <PLink href={businessUrl(b, "/coach")} variant="ink" prefetch={false}>
                        Go to your dashboard
                      </PLink>
                    </Panel>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {profile.is_platform_admin ? (
          <p className="text-sm p-muted">
            You&apos;re a platform admin.{" "}
            <Link href="/admin" className="font-semibold text-brand">
              Open the admin dashboard
            </Link>
          </p>
        ) : null}
      </div>
      <Panel className="p-6 sm:p-8">
        <h2 className="text-2xl font-bold">{mine.length ? "Start another business" : "Set up your business"}</h2>
        <div className="mb-6 mt-1 text-sm p-muted">
          Signed in as {profile.email}.{" "}
          <form action="/auth/signout" method="post" className="inline">
            <button type="submit" className="underline underline-offset-4">
              Not you?
            </button>
          </form>
        </div>
        <BusinessForm domain={domain} />
      </Panel>
    </Section>
  );
}

function Intro({ step, fee, hasBusiness }: { step: 1 | 2; fee: string; hasBusiness?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        {hasBusiness ? "Welcome back" : `Step ${step} of 2`}
      </p>
      <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
        {hasBusiness ? "Pick up where you left off." : `Launch your business on ${PLATFORM_NAME}.`}
      </h1>
      <p className="mt-4 max-w-lg text-lg p-muted">
        Your own branded site, booking page and client app, live in a couple of minutes.
      </p>
      {hasBusiness ? null : (
        <ul className="mt-8 grid gap-3 text-[15px]">
          {[
            "A free consult and a 1:1 session ready to book",
            "Weekday hours set up (change them anytime)",
            "Connect Stripe when you're ready to take payments",
            `$0/month; ${fee} only when clients pay you`,
          ].map((t) => (
            <li key={t} className="flex gap-3">
              <Check className="mt-0.5" /> {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
