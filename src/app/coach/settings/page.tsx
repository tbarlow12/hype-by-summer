import type { Metadata } from "next";
import { PasswordCard } from "@/components/account/password-card";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardTitle, Checkbox, Field, Input, LinkButton, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { ImageUpload } from "@/components/clients/image-upload";
import { CopyField } from "@/components/clients/copy-field";
import { BrandingFields } from "@/components/clients/branding-fields";
import { PLATFORM_DOMAIN, tenantUrl } from "@/lib/platform";
import { businessUrl, type Business } from "@/lib/tenant";
import { formatDateTime } from "@/lib/format";
import { REMINDER_HOUR_OPTIONS, reminderLabel } from "@/lib/clients/settings";
import { FONT_PRESET_VALUES, type FontPreset } from "@/lib/clients/branding";
import { dnsRecordsFor } from "@/lib/clients/domains";
import { projectDomainStatus, vercelConfigured, type DomainStatus } from "@/lib/clients/vercel";
import {
  regenerateFeedToken,
  updateBranding,
  updateBusinessProfile,
  updateCoachProfile,
  updatePersonal,
  updatePolicies,
} from "./actions";
import { checkCustomDomain, removeCustomDomain, setCustomDomain } from "./domain-actions";

export const metadata: Metadata = { title: "Settings" };

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

export default async function SettingsPage() {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const supabase = await createClient();
  // The private ICS token isn't exposed to the user's API role; read only the caller's own.
  const [{ data: me }, { data: types }] = await Promise.all([
    createAdminClient()
      .from("business_members")
      .select("title, bio, specialties, slug, calendar_feed_token")
      .eq("business_id", business.id)
      .eq("user_id", profile.id)
      .single(),
    manager
      ? supabase.from("session_types").select("id, name, slug, clients_only, active").eq("business_id", business.id).eq("active", true).order("sort_order")
      : Promise.resolve({ data: null }),
  ]);

  const feedUrl = me ? businessUrl(business, `/api/calendar/${me.calendar_feed_token}`) : null;
  const webcalUrl = feedUrl?.replace(/^https?:\/\//, "webcal://");
  const timezones = Intl.supportedValuesOf("timeZone");
  const sections: [string, string][] = manager
    ? [
        ["#share", "Your site"],
        ["#business", "Business"],
        ["#branding", "Branding"],
        ["#domain", "Custom domain"],
        ["#policies", "Policies"],
        ["#payments", "Payments"],
        ["#profile", "My profile"],
        ["#calendar", "Calendar sync"],
      ]
    : [
        ["#profile", "My profile"],
        ["#calendar", "Calendar sync"],
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={manager ? "Settings" : "My profile"}
        description={
          manager
            ? "Your business, branding, domain, policies, and your own profile."
            : "Your details, your coach profile and your calendar feed. Business settings are managed by owners and admins."
        }
      />

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 text-sm">
        {sections.map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
            {label}
          </a>
        ))}
      </nav>

      {manager ? (
        <>
          <ShareCard business={business} types={types ?? []} />
          <BusinessCard business={business} timezones={timezones} />

          <Card id="branding" className="scroll-mt-6">
            <CardTitle>Branding</CardTitle>
            <p className="mt-1 text-sm text-zinc-500">Your logo, color and fonts appear on your site, client app, emails and app icon.</p>
            <ActionForm action={updateBranding} className="mt-4 space-y-4">
              <BrandingFields
                businessId={business.id}
                businessName={business.name}
                logoUrl={business.logo_url}
                color={business.brand_color}
                font={(FONT_PRESET_VALUES as readonly string[]).includes(business.font_preset) ? (business.font_preset as FontPreset) : "athletic"}
              />
              <SubmitButton>Save branding</SubmitButton>
            </ActionForm>
          </Card>

          <DomainCard business={business} />
          <PoliciesCard business={business} />
          <PaymentsCard business={business} />
        </>
      ) : null}

      <Card id="profile" className="scroll-mt-6">
        <CardTitle>My profile</CardTitle>
        <ActionForm action={updatePersonal} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ImageUpload folder={profile.id} name="avatar_url" prefix="avatar" defaultUrl={profile.avatar_url} label="Photo" />
          </div>
          <Field label="Name" htmlFor="full_name">
            <Input id="full_name" name="full_name" defaultValue={profile.full_name ?? ""} required />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} />
          </Field>
          <Field label="My timezone" htmlFor="my_timezone" hint="Your dashboard and calendar show times in this zone." className="sm:col-span-2">
            <TimezoneSelect id="my_timezone" value={profile.timezone} timezones={timezones} />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card id="coach-profile" className="scroll-mt-6">
        <CardTitle>Coach profile</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">Shown to clients on {business.name}&apos;s site and when they book with you.</p>
        <ActionForm action={updateCoachProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="coach_title">
            <Input id="coach_title" name="title" defaultValue={me?.title ?? ""} placeholder="Head coach, NASM-CPT" />
          </Field>
          <Field label="Profile link" htmlFor="coach_slug" hint="Lowercase letters, numbers and dashes.">
            <Input id="coach_slug" name="slug" defaultValue={me?.slug ?? ""} pattern="[a-z0-9][a-z0-9\-]{0,40}" />
          </Field>
          <Field label="Bio" htmlFor="coach_bio" className="sm:col-span-2">
            <Textarea id="coach_bio" name="bio" defaultValue={me?.bio ?? ""} className="min-h-28" />
          </Field>
          <Field label="Specialties" htmlFor="coach_specialties" hint="Comma separated" className="sm:col-span-2">
            <Input id="coach_specialties" name="specialties" defaultValue={me?.specialties.join(", ") ?? ""} placeholder="Strength, Postpartum, Mobility" />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Save coach profile</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {feedUrl ? (
        <Card id="calendar" className="scroll-mt-6">
          <CardTitle>Calendar subscription</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">
            See your sessions in Google Calendar, Apple Calendar or Outlook. The feed updates automatically (Google refreshes every few hours).
            Keep this link private: anyone with it can see your schedule.
          </p>
          <div className="mt-3">
            <CopyField value={feedUrl} label="Private calendar feed URL" />
          </div>
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <h3 className="font-semibold">Google Calendar</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
                <li>Open calendar.google.com on a computer.</li>
                <li>Next to &ldquo;Other calendars&rdquo;, click + then &ldquo;From URL&rdquo;.</li>
                <li>Paste the link above and click &ldquo;Add calendar&rdquo;.</li>
              </ol>
            </div>
            <div>
              <h3 className="font-semibold">Apple Calendar</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-400">
                <li>
                  On iPhone or Mac, tap{" "}
                  <a href={webcalUrl} className="font-medium text-brand hover:underline">
                    subscribe
                  </a>
                  , or
                </li>
                <li>Mac: File → New Calendar Subscription and paste the link.</li>
                <li>iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</li>
              </ol>
            </div>
          </div>
          <ActionForm action={regenerateFeedToken} className="mt-4">
            <p className="mb-2 text-xs text-zinc-500">Shared the link by mistake? Create a new one; the old link stops working.</p>
            <SubmitButton variant="outline" size="sm" pendingLabel="Regenerating…">
              Regenerate link
            </SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      <PasswordCard />
    </div>
  );
}

function TimezoneSelect({ id, name, value, timezones }: { id: string; name?: string; value: string; timezones: string[] }) {
  return (
    <Select id={id} name={name ?? "timezone"} defaultValue={value}>
      {timezones.includes(value) ? null : <option value={value}>{value}</option>}
      {timezones.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );
}

function ShareCard({ business, types }: { business: Business; types: { id: string; name: string; slug: string; clients_only: boolean }[] }) {
  const platformAddress = tenantUrl({ slug: business.slug }, "/");
  const home = businessUrl(business, "/");
  const bookUrl = businessUrl(business, "/book");
  return (
    <Card id="share" className="scroll-mt-6">
      <CardTitle>Your site & booking links</CardTitle>
      <p className="mt-1 text-sm text-zinc-500">Share these in your Instagram bio, emails and texts. Clients sign in to the app at the same address.</p>
      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Website {business.custom_domain && business.domain_verified_at ? <Badge tone="green">Custom domain</Badge> : null}
          </p>
          <CopyField value={home} label="Website link" />
          {home !== platformAddress ? <p className="mt-1 text-xs text-zinc-500">Also reachable at {platformAddress}</p> : null}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Booking page</p>
          <CopyField value={bookUrl} label="Booking page link" />
        </div>
        {types.filter((t) => !t.clients_only).length ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Direct links to each session type</summary>
            <ul className="mt-2 space-y-2">
              {types
                .filter((t) => !t.clients_only)
                .map((t) => (
                  <li key={t.id}>
                    <p className="mb-1 text-xs text-zinc-500">{t.name}</p>
                    <CopyField value={businessUrl(business, `/book/${business.slug}/${t.slug}`)} label={`${t.name} booking link`} />
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href="/" variant="outline" size="sm" target="_blank">
          Open site
        </LinkButton>
        <LinkButton href="/book" variant="outline" size="sm" target="_blank">
          Open booking page
        </LinkButton>
      </div>
    </Card>
  );
}

function BusinessCard({ business, timezones }: { business: Business; timezones: string[] }) {
  return (
    <Card id="business" className="scroll-mt-6">
      <CardTitle>Business profile</CardTitle>
      <ActionForm action={updateBusinessProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="biz_name">
          <Input id="biz_name" name="name" defaultValue={business.name} required maxLength={120} />
        </Field>
        <Field label="Platform address" htmlFor="biz_slug" hint={`${business.slug}.${PLATFORM_DOMAIN}. Changing it breaks old links.`}>
          <Input id="biz_slug" name="slug" defaultValue={business.slug} required pattern="[a-z0-9][a-z0-9\-]{1,40}" />
        </Field>
        <Field label="Headline" htmlFor="biz_headline" className="sm:col-span-2">
          <Input id="biz_headline" name="headline" defaultValue={business.headline ?? ""} placeholder="Strength coaching for busy parents" />
        </Field>
        <Field label="About" htmlFor="biz_bio" className="sm:col-span-2">
          <Textarea id="biz_bio" name="bio" defaultValue={business.bio ?? ""} className="min-h-32" />
        </Field>
        <Field label="Specialties" htmlFor="biz_specialties" hint="Comma separated">
          <Input id="biz_specialties" name="specialties" defaultValue={business.specialties.join(", ")} placeholder="Strength, Fat loss, Postpartum" />
        </Field>
        <Field label="Certifications" htmlFor="biz_certifications" hint="One per line">
          <Textarea id="biz_certifications" name="certifications" defaultValue={business.certifications.join("\n")} className="min-h-20" />
        </Field>
        <Field label="Instagram" htmlFor="biz_instagram">
          <Input id="biz_instagram" name="instagram_handle" defaultValue={business.instagram_handle ?? ""} placeholder="@yourhandle" />
        </Field>
        <Field label="Website" htmlFor="biz_website">
          <Input id="biz_website" name="website_url" type="url" defaultValue={business.website_url ?? ""} placeholder="https://" />
        </Field>
        <Field label="Contact email" htmlFor="biz_support" hint="Clients' replies to your emails go here.">
          <Input id="biz_support" name="support_email" type="email" defaultValue={business.support_email ?? ""} />
        </Field>
        <Field label="Default location" htmlFor="biz_location" hint="Gym or studio address for in-person sessions.">
          <Input id="biz_location" name="default_location" defaultValue={business.default_location ?? ""} />
        </Field>
        <Field label="Business timezone" htmlFor="biz_timezone" hint="Availability, reminders and reports use this." className="sm:col-span-2">
          <TimezoneSelect id="biz_timezone" value={business.timezone} timezones={timezones} />
        </Field>
        <div className="sm:col-span-2">
          <ImageUpload folder={business.id} name="cover_image_url" prefix="cover" defaultUrl={business.cover_image_url} label="Cover image" shape="wide" />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton>Save business profile</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

async function DomainCard({ business }: { business: Business }) {
  const domain = business.custom_domain;
  const vercel = vercelConfigured();
  let status: DomainStatus | null = null;
  if (domain && vercel) {
    try {
      status = await projectDomainStatus(domain);
    } catch (err) {
      console.error("[settings] domain status failed", err);
    }
  }
  const live = Boolean(domain && business.domain_verified_at);
  const records = domain ? dnsRecordsFor(domain, { verification: status?.verification, cname: status?.cname, aValue: status?.aValue }) : [];
  const broken = live && status && (status.misconfigured || !status.verified);

  return (
    <Card id="domain" className="scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Custom domain</CardTitle>
        {domain ? (
          <Badge tone={live ? (broken ? "amber" : "green") : "amber"}>{live ? (broken ? "Check DNS" : "Connected") : "Waiting for DNS"}</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Use your own address, like <span className="font-mono">book.yourstudio.com</span>, for your site and client app. Your platform address{" "}
        <span className="font-mono">{business.slug}.{PLATFORM_DOMAIN}</span> keeps working either way.
      </p>

      {!domain ? (
        <ActionForm action={setCustomDomain} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Domain" htmlFor="domain" className="flex-1">
            <Input id="domain" name="domain" placeholder="book.yourstudio.com" required autoComplete="off" spellCheck={false} />
          </Field>
          <SubmitButton pendingLabel="Adding…">Add domain</SubmitButton>
        </ActionForm>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            <span className="font-mono font-semibold">{domain}</span>
            {live && business.domain_verified_at ? (
              <span className="text-zinc-500"> · connected {formatDateTime(business.domain_verified_at, business.timezone, "MMM d, yyyy")}</span>
            ) : null}
          </p>
          {broken ? (
            <Alert tone="amber">Your hosting provider reports a DNS problem with this domain. Check the records below are still in place.</Alert>
          ) : null}
          {!live || broken ? (
            <>
              <p className="text-sm">Add {records.length === 1 ? "this record" : "these records"} at your domain provider (GoDaddy, Namecheap, Cloudflare, Squarespace…):</p>
              <Table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name / host</th>
                    <th>Value / points to</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={`${r.type}-${r.name}-${r.value}`}>
                      <td className="font-mono">{r.type}</td>
                      <td className="font-mono">{r.name}</td>
                      <td className="font-mono break-all">
                        {r.value}
                        {r.note ? <span className="block font-sans text-xs text-zinc-500">{r.note}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-xs text-zinc-500">
                Using Cloudflare? Set the record to &ldquo;DNS only&rdquo; (grey cloud). Changes usually take a few minutes, sometimes up to 48 hours.
                {vercel ? "" : " We'll check public DNS when you press “Check now”."}
              </p>
            </>
          ) : (
            <CopyField value={`https://${domain}`} label="Custom domain URL" />
          )}
          <div className="flex flex-wrap gap-2">
            <ActionForm action={checkCustomDomain}>
              <SubmitButton size="sm" pendingLabel="Checking…">
                Check now
              </SubmitButton>
            </ActionForm>
            <ActionForm action={removeCustomDomain}>
              <SubmitButton size="sm" variant="outline" pendingLabel="Removing…">
                Remove domain
              </SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}
    </Card>
  );
}

function PoliciesCard({ business }: { business: Business }) {
  return (
    <Card id="policies" className="scroll-mt-6">
      <CardTitle>Booking policies</CardTitle>
      <ActionForm action={updatePolicies} className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Cancellation window (hours)" htmlFor="cancellation_window_hours" hint="Cancelling later than this counts as a late cancel.">
          <Input id="cancellation_window_hours" name="cancellation_window_hours" type="number" min={0} max={720} defaultValue={business.cancellation_window_hours} required />
        </Field>
        <Field label="Late cancel fee ($)" htmlFor="late_cancel_fee">
          <Input id="late_cancel_fee" name="late_cancel_fee" type="number" min={0} step="0.01" defaultValue={dollars(business.late_cancel_fee_cents)} />
        </Field>
        <Field label="No-show fee ($)" htmlFor="no_show_fee">
          <Input id="no_show_fee" name="no_show_fee" type="number" min={0} step="0.01" defaultValue={dollars(business.no_show_fee_cents)} />
        </Field>
        <fieldset className="sm:col-span-3">
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Send reminders before each session</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {REMINDER_HOUR_OPTIONS.map((h) => (
              <Checkbox key={h} name="reminder_hours[]" value={String(h)} defaultChecked={business.reminder_hours.includes(h)} label={reminderLabel(h)} />
            ))}
          </div>
        </fieldset>
        <div className="space-y-2 sm:col-span-3">
          <Checkbox name="refund_on_cancel" defaultChecked={business.refund_on_cancel} label="Refund payment (or return credits) when a client cancels inside the policy window" />
          <Checkbox name="accepting_new_clients" defaultChecked={business.accepting_new_clients} label="Accepting new clients (shown on your site)" />
        </div>
        <div className="sm:col-span-3">
          <SubmitButton>Save policies</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

function PaymentsCard({ business }: { business: Business }) {
  const connected = Boolean(business.stripe_account_id);
  const ready = business.stripe_charges_enabled && business.stripe_payouts_enabled;
  return (
    <Card id="payments" className="scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Payments & plan</CardTitle>
        <Badge tone={ready ? "green" : connected ? "amber" : "neutral"}>
          {ready ? "Accepting payments" : connected ? "Setup incomplete" : "Not connected"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Client payments go straight to your own Stripe account. Manage payouts and your platform plan here.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton href="/coach/payments/setup" size="sm" variant={ready ? "outline" : "primary"}>
          {ready ? "Payout settings" : "Set up payments"}
        </LinkButton>
        <LinkButton href="/coach/payments/plan" size="sm" variant="outline">
          Your plan
        </LinkButton>
        <LinkButton href="/coach/payments" size="sm" variant="ghost">
          View payments
        </LinkButton>
      </div>
    </Card>
  );
}
