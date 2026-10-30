"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, cn } from "@/components/ui";
import { submitLeadMagnet } from "@/app/(marketing)/actions";
import { consentText, EXPERIENCE_LEVELS, FORMATS, GOALS, TIMELINES, type Option } from "@/lib/leads/options";

export type LeadMagnetFormMagnet = {
  id: string;
  cta_label: string;
  ask_phone: boolean;
  ask_goal: boolean;
};

function OptionSelect({ id, name, options, placeholder }: { id: string; name: string; options: Option[]; placeholder: string }) {
  return (
    <Select id={id} name={name} defaultValue="">
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Opt-in form for a lead magnet. `compact` shows only the essentials (homepage
 * blocks); the full version adds optional qualifying questions.
 */
export function LeadMagnetForm({
  magnet,
  brandName,
  compact = false,
  tone = "light",
  className,
}: {
  magnet: LeadMagnetFormMagnet;
  /** The business's name, used in the marketing-consent wording. */
  brandName: string;
  compact?: boolean;
  /** "dark" renders labels for a dark background. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const id = useId();
  const f = (name: string) => `${id}-${name}`;
  const labelTone = tone === "dark" ? "[&_label]:text-zinc-200 [&_p]:text-zinc-400" : "";

  return (
    <ActionForm action={submitLeadMagnet} className={cn("flex flex-col gap-4", labelTone, className)}>
      <input type="hidden" name="magnet_id" value={magnet.id} />
      {/* Honeypot */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={f("website")}>Website</label>
        <input id={f("website")} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor={f("first_name")}>
          <Input id={f("first_name")} name="first_name" autoComplete="given-name" required maxLength={100} />
        </Field>
        <Field label="Email" htmlFor={f("email")}>
          <Input id={f("email")} name="email" type="email" autoComplete="email" required maxLength={320} />
        </Field>
      </div>

      {magnet.ask_phone ? (
        <Field label="Phone (optional)" htmlFor={f("phone")} hint={compact ? undefined : "Only if you'd like a quick text with tips. No spam."}>
          <Input id={f("phone")} name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </Field>
      ) : null}

      {magnet.ask_goal ? (
        <Field label="What's your main goal?" htmlFor={f("primary_goal")}>
          <OptionSelect id={f("primary_goal")} name="primary_goal" options={GOALS} placeholder="Choose one…" />
        </Field>
      ) : null}

      {compact ? null : (
        <fieldset className="grid gap-4 rounded-2xl border border-zinc-200 p-4 sm:grid-cols-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Help us personalize it (optional)
          </legend>
          <Field label="Experience" htmlFor={f("experience_level")}>
            <OptionSelect id={f("experience_level")} name="experience_level" options={EXPERIENCE_LEVELS} placeholder="Select…" />
          </Field>
          <Field label="Preferred format" htmlFor={f("preferred_format")}>
            <OptionSelect id={f("preferred_format")} name="preferred_format" options={FORMATS} placeholder="Select…" />
          </Field>
          <Field label="When to start" htmlFor={f("timeline")}>
            <OptionSelect id={f("timeline")} name="timeline" options={TIMELINES} placeholder="Select…" />
          </Field>
        </fieldset>
      )}

      <Checkbox name="marketing_consent" label={consentText(brandName)} className={tone === "dark" ? "text-zinc-300" : undefined} />

      <SubmitButton size="lg" pendingLabel="Sending your guide…" className="w-full">
        {magnet.cta_label}
      </SubmitButton>
      <p className="text-center text-xs text-zinc-500">Free instant download. We&apos;ll also email you a copy.</p>
    </ActionForm>
  );
}
