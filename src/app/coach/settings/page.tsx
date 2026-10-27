import { PasswordCard } from "@/components/account/password-card";
import type { Metadata } from "next";
import { requireTrainer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, CardTitle, Checkbox, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { ImageUpload } from "@/components/clients/image-upload";
import { CopyField } from "@/components/clients/copy-field";
import { absoluteUrl } from "@/lib/env";
import { REMINDER_HOUR_OPTIONS, reminderLabel } from "@/lib/clients/settings";
import { regenerateFeedToken, updatePersonal, updatePolicies, updateStorefront } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

export default async function SettingsPage() {
  const trainer = await requireTrainer();
  // Full row incl. the private ICS token, scoped to the signed-in trainer.
  const admin = createAdminClient();
  const { data: store } = await admin.from("trainer_profiles").select("*").eq("trainer_id", trainer.id).maybeSingle();
  if (!store) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Alert tone="amber">Finish setting up your storefront first.</Alert>
        <LinkButton href="/onboarding" className="mt-4">
          Set up storefront
        </LinkButton>
      </div>
    );
  }

  const bookingUrl = absoluteUrl(`/book/${store.slug}`);
  const feedUrl = absoluteUrl(`/api/calendar/${store.calendar_feed_token}`);
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your public storefront, booking policies, profile and calendar sync." />

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 text-sm">
        {[
          ["#share", "Share"],
          ["#storefront", "Storefront"],
          ["#policies", "Policies"],
          ["#personal", "Personal"],
          ["#calendar", "Calendar sync"],
          ["#payments", "Payments"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
            {label}
          </a>
        ))}
      </nav>

      <Card id="share" className="scroll-mt-6">
        <CardTitle>Your booking page</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">Share this link in your Instagram bio, emails and texts so people can book you directly.</p>
        <div className="mt-3">
          <CopyField value={bookingUrl} label="Booking page link" />
        </div>
        <LinkButton href={`/book/${store.slug}`} variant="outline" size="sm" className="mt-3" target="_blank">
          Open booking page
        </LinkButton>
      </Card>

      <Card id="storefront" className="scroll-mt-6">
        <CardTitle>Storefront</CardTitle>
        <ActionForm action={updateStorefront} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="business_name">
            <Input id="business_name" name="business_name" defaultValue={store.business_name} required />
          </Field>
          <Field label="Booking link" htmlFor="slug" hint={`${absoluteUrl("/book/")}${store.slug}. Changing it breaks old links.`}>
            <Input id="slug" name="slug" defaultValue={store.slug} required pattern="[a-z0-9][a-z0-9\-]{1,40}" />
          </Field>
          <Field label="Headline" htmlFor="headline" className="sm:col-span-2">
            <Input id="headline" name="headline" defaultValue={store.headline ?? ""} placeholder="Strength coaching for busy parents" />
          </Field>
          <Field label="Bio" htmlFor="bio" className="sm:col-span-2">
            <Textarea id="bio" name="bio" defaultValue={store.bio ?? ""} className="min-h-32" />
          </Field>
          <Field label="Specialties" htmlFor="specialties" hint="Comma separated">
            <Input id="specialties" name="specialties" defaultValue={store.specialties.join(", ")} placeholder="Strength, Fat loss, Postpartum" />
          </Field>
          <Field label="Certifications" htmlFor="certifications" hint="One per line">
            <Textarea id="certifications" name="certifications" defaultValue={store.certifications.join("\n")} className="min-h-20" />
          </Field>
          <Field label="Instagram" htmlFor="instagram_handle">
            <Input id="instagram_handle" name="instagram_handle" defaultValue={store.instagram_handle ?? ""} placeholder="@yourhandle" />
          </Field>
          <Field label="Website" htmlFor="website_url">
            <Input id="website_url" name="website_url" type="url" defaultValue={store.website_url ?? ""} placeholder="https://" />
          </Field>
          <Field label="Brand colour" htmlFor="brand_color">
            <Input id="brand_color" name="brand_color" type="color" defaultValue={store.brand_color} className="w-20 p-1" />
          </Field>
          <div className="sm:col-span-2">
            <ImageUpload userId={trainer.id} name="cover_image_url" prefix="cover" defaultUrl={store.cover_image_url} label="Cover image" shape="wide" />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>Save storefront</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card id="policies" className="scroll-mt-6">
        <CardTitle>Booking policies</CardTitle>
        <ActionForm action={updatePolicies} className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Cancellation window (hours)" htmlFor="cancellation_window_hours" hint="Cancelling later than this counts as a late cancel.">
            <Input id="cancellation_window_hours" name="cancellation_window_hours" type="number" min={0} max={720} defaultValue={store.cancellation_window_hours} required />
          </Field>
          <Field label="Late cancel fee ($)" htmlFor="late_cancel_fee">
            <Input id="late_cancel_fee" name="late_cancel_fee" type="number" min={0} step="0.01" defaultValue={dollars(store.late_cancel_fee_cents)} />
          </Field>
          <Field label="No-show fee ($)" htmlFor="no_show_fee">
            <Input id="no_show_fee" name="no_show_fee" type="number" min={0} step="0.01" defaultValue={dollars(store.no_show_fee_cents)} />
          </Field>
          <fieldset className="sm:col-span-3">
            <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Send reminders before each session</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {REMINDER_HOUR_OPTIONS.map((h) => (
                <Checkbox key={h} name="reminder_hours[]" value={String(h)} defaultChecked={store.reminder_hours.includes(h)} label={reminderLabel(h)} />
              ))}
            </div>
          </fieldset>
          <div className="space-y-2 sm:col-span-3">
            <Checkbox name="refund_on_cancel" defaultChecked={store.refund_on_cancel} label="Refund payment (or return credits) when a client cancels inside the policy window" />
            <Checkbox name="accepting_new_clients" defaultChecked={store.accepting_new_clients} label="Accepting new clients (shown on your storefront)" />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton>Save policies</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card id="personal" className="scroll-mt-6">
        <CardTitle>Personal</CardTitle>
        <ActionForm action={updatePersonal} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ImageUpload userId={trainer.id} name="avatar_url" prefix="avatar" defaultUrl={trainer.avatar_url} label="Profile photo" />
          </div>
          <Field label="Name" htmlFor="full_name">
            <Input id="full_name" name="full_name" defaultValue={trainer.full_name ?? ""} required />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={trainer.phone ?? ""} />
          </Field>
          <Field label="Timezone" htmlFor="timezone" hint="Availability, your dashboard and reminders use this." className="sm:col-span-2">
            <Select id="timezone" name="timezone" defaultValue={trainer.timezone}>
              {timezones.includes(trainer.timezone) ? null : <option value={trainer.timezone}>{trainer.timezone}</option>}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card id="calendar" className="scroll-mt-6">
        <CardTitle>Calendar subscription</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          See every booking in Google Calendar, Apple Calendar or Outlook. The feed updates automatically (Google refreshes every few hours).
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

      <Card id="payments" className="scroll-mt-6">
        <CardTitle>Payments</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          Payments go to your Stripe account. Use the Stripe dashboard for payouts, disputes, tax settings and your branding on receipts.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" variant="outline" size="sm">
            Stripe dashboard
          </LinkButton>
          <LinkButton href="https://dashboard.stripe.com/payouts" target="_blank" rel="noopener noreferrer" variant="outline" size="sm">
            Payouts
          </LinkButton>
          <LinkButton href="https://dashboard.stripe.com/settings/branding" target="_blank" rel="noopener noreferrer" variant="outline" size="sm">
            Receipt branding
          </LinkButton>
          <LinkButton href="/coach/payments" variant="ghost" size="sm">
            View payments
          </LinkButton>
        </div>
      </Card>
      <PasswordCard />
    </div>
  );
}
