import type { Metadata } from "next";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardTitle, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ImageUpload } from "@/components/clients/image-upload";
import { TestimonialForm } from "@/components/testimonial-form";
import { PasswordCard } from "@/components/account/password-card";
import { formatDateTime } from "@/lib/format";
import { BRAND_NAME } from "@/lib/env";
import { EXPERIENCE_LEVELS, PARQ_QUESTIONS, PRIMARY_GOALS, parqFlags, readParqAnswers } from "@/lib/clients/intake";
import { onboardingSteps, waiverCurrent } from "@/lib/clients/onboarding";
import { WAIVER_TITLE, WAIVER_VERSION, waiverSections } from "@/lib/clients/waiver";
import { saveIntake, signWaiver, updateProfile } from "./actions";

export const metadata: Metadata = { title: "Profile & intake" };

export default async function ProfilePage() {
  const profile = await requireClient();
  const trainerId = await getClientTrainerId(profile.id);
  const supabase = await createClient();
  const [{ data: intake }, { data: storefront }] = await Promise.all([
    trainerId
      ? supabase.from("client_intakes").select("*").eq("client_id", profile.id).eq("trainer_id", trainerId).maybeSingle()
      : Promise.resolve({ data: null }),
    trainerId
      ? supabase.from("trainer_profiles").select("business_name").eq("trainer_id", trainerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const answers = readParqAnswers(intake?.answers);
  const flags = parqFlags(answers);
  const steps = onboardingSteps({ profile, intake, hasBooking: true });
  const signed = waiverCurrent(intake);
  const outdatedSignature = !!intake?.waiver_accepted_at && !signed;
  const timezones = Intl.supportedValuesOf("timeZone");
  const businessName = storefront?.business_name ?? BRAND_NAME;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & intake"
        description="Keep your details current, tell your coach about your health and training, and sign the waiver."
      />

      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {steps
          .filter((s) => s.key !== "book")
          .map((s) => (
            <a
              key={s.key}
              href={s.href.replace("/me/profile", "")}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              {s.title}
              <Badge tone={s.done ? "green" : "amber"}>{s.done ? "Done" : "To do"}</Badge>
            </a>
          ))}
      </nav>

      <Card id="profile" className="scroll-mt-6">
        <CardTitle>Your profile</CardTitle>
        <ActionForm action={updateProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ImageUpload userId={profile.id} name="avatar_url" prefix="avatar" defaultUrl={profile.avatar_url} label="Photo" />
          </div>
          <Field label="Full name" htmlFor="full_name">
            <Input id="full_name" name="full_name" defaultValue={profile.full_name ?? ""} required autoComplete="name" />
          </Field>
          <Field label="Email" hint="Contact your coach to change your login email.">
            <Input value={profile.email} disabled readOnly />
          </Field>
          <Field label="Mobile phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" />
          </Field>
          <Field label="Date of birth" htmlFor="date_of_birth">
            <Input id="date_of_birth" name="date_of_birth" type="date" defaultValue={profile.date_of_birth ?? ""} />
          </Field>
          <Field label="Timezone" htmlFor="timezone" hint="Session times and reminders use this timezone." className="sm:col-span-2">
            <Select id="timezone" name="timezone" defaultValue={profile.timezone}>
              {timezones.includes(profile.timezone) ? null : <option value={profile.timezone}>{profile.timezone}</option>}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox name="sms_opt_in" defaultChecked={profile.sms_opt_in} label="Text me session reminders and schedule changes (message and data rates may apply; reply STOP to opt out)." />
            <Checkbox name="marketing_opt_in" defaultChecked={profile.marketing_opt_in} label={`Email me tips, offers and news from ${businessName}. Unsubscribe any time.`} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>Save profile</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card id="intake" className="scroll-mt-6">
        <CardTitle>Health intake</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          Only you and your coach can see this. If anything changes (a new injury, medication or pregnancy), update it here.
        </p>
        {!trainerId ? (
          <div className="mt-4">
            <Alert tone="amber">You&apos;re not connected to a coach yet, so the intake can&apos;t be saved.</Alert>
          </div>
        ) : null}
        {flags.length ? (
          <div className="mt-4">
            <Alert tone="amber">
              You answered yes to {flags.length === 1 ? "a readiness question" : `${flags.length} readiness questions`}. Please talk
              to your doctor before increasing your activity, and share their advice with your coach.
            </Alert>
          </div>
        ) : null}
        <ActionForm action={saveIntake} className="mt-4 space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold">Physical activity readiness</legend>
            <ol className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {PARQ_QUESTIONS.map((q, i) => {
                const v = answers[q.key];
                return (
                  <li key={q.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span id={`q-${q.key}`} className="text-sm">
                      {i + 1}. {q.text}
                    </span>
                    <span role="radiogroup" aria-labelledby={`q-${q.key}`} className="flex shrink-0 gap-4 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`parq_${q.key}`} value="yes" defaultChecked={v === true} required className="accent-brand" />
                        Yes
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`parq_${q.key}`} value="no" defaultChecked={v === false} className="accent-brand" />
                        No
                      </label>
                    </span>
                  </li>
                );
              })}
            </ol>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Injuries, surgeries or limitations" htmlFor="injuries" className="sm:col-span-2">
              <Textarea id="injuries" name="injuries" defaultValue={intake?.injuries ?? ""} placeholder="e.g. Left ACL repair 2022, occasional lower-back tightness" />
            </Field>
            <Field label="Medications or supplements your coach should know about" htmlFor="medications" className="sm:col-span-2">
              <Textarea id="medications" name="medications" defaultValue={intake?.medications ?? ""} />
            </Field>
            <Field label="Training experience" htmlFor="experience_level">
              <Select id="experience_level" name="experience_level" defaultValue={intake?.experience_level ?? ""} required>
                <option value="" disabled>
                  Choose one
                </option>
                {EXPERIENCE_LEVELS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Primary goal" htmlFor="primary_goal">
              <Select id="primary_goal" name="primary_goal" defaultValue={intake?.primary_goal ?? ""} required>
                <option value="" disabled>
                  Choose one
                </option>
                {PRIMARY_GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Emergency contact name" htmlFor="emergency_contact_name">
              <Input id="emergency_contact_name" name="emergency_contact_name" defaultValue={intake?.emergency_contact_name ?? ""} required />
            </Field>
            <Field label="Emergency contact phone" htmlFor="emergency_contact_phone">
              <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" defaultValue={intake?.emergency_contact_phone ?? ""} required />
            </Field>
          </div>
          <SubmitButton>Save intake</SubmitButton>
        </ActionForm>
      </Card>

      <Card id="waiver" className="scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Liability waiver</CardTitle>
          <Badge tone={signed ? "green" : "amber"}>{signed ? "Signed" : "Signature needed"}</Badge>
        </div>
        {signed && intake?.waiver_accepted_at ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Signed as <strong>{intake.waiver_signature}</strong> on {formatDateTime(intake.waiver_accepted_at, profile.timezone)} (version{" "}
            {intake.waiver_version}).
          </p>
        ) : null}
        {outdatedSignature ? (
          <div className="mt-3">
            <Alert tone="amber">The waiver has been updated since you last signed. Please review and sign the new version.</Alert>
          </div>
        ) : null}

        <details className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800" open={!signed}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{WAIVER_TITLE}</summary>
          <div className="max-h-96 space-y-3 overflow-y-auto border-t border-zinc-200 px-4 py-3 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
            {waiverSections(businessName).map((s) => (
              <section key={s.heading}>
                <h3 className="font-semibold">{s.heading}</h3>
                <p className="mt-1">{s.body}</p>
              </section>
            ))}
            <p className="text-xs text-zinc-500">Version {WAIVER_VERSION}</p>
          </div>
        </details>

        {!signed && trainerId ? (
          <ActionForm action={signWaiver} className="mt-4 space-y-4">
            <input type="hidden" name="version" value={WAIVER_VERSION} />
            <Checkbox name="agree" required label="I have read and understand this waiver, and I agree to its terms." />
            <Field label="Type your full legal name to sign" htmlFor="signature">
              <Input id="signature" name="signature" required autoComplete="name" defaultValue="" placeholder={profile.full_name ?? "Your full name"} className="font-serif italic" />
            </Field>
            <SubmitButton pendingLabel="Signing…">Sign waiver</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>

      <PasswordCard />

      {trainerId ? (
        <Card>
          <CardTitle>Leave a review</CardTitle>
          <p className="mb-4 mt-1 text-sm text-zinc-500">Enjoying your training? A short review helps others find {businessName}.</p>
          <TestimonialForm defaultName={profile.full_name} />
        </Card>
      ) : null}
    </div>
  );
}
