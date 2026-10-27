"use client";

import { useId, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { ActionState } from "@/lib/actions";
import type { Tables } from "@/lib/supabase/database.types";

type Offering = Tables<"offerings">;
type Kind = Offering["kind"];

const KIND_HELP: Record<Kind, string> = {
  package: "A one-time purchase that adds session credits (e.g. a 10-session pack).",
  subscription: "A recurring membership. Optional session credits are added each billing period.",
  one_time: "A one-off product: a downloadable file (program, guide) or a service.",
};

const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function OfferingForm({
  action,
  offering,
  sessionTypes,
  trainerId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  offering?: Offering | null;
  sessionTypes: { id: string; name: string }[];
  trainerId: string;
}) {
  const [kind, setKind] = useState<Kind>(offering?.kind ?? "package");
  const [credits, setCredits] = useState(offering?.credits ?? (kind === "package" ? 10 : 0));
  const uid = useId();
  const f = (name: string) => `${uid}-${name}`;
  const selected = new Set(offering?.session_type_ids ?? []);

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      {offering ? <input type="hidden" name="id" value={offering.id} /> : null}

      <Field label="Type" htmlFor={f("kind")} hint={KIND_HELP[kind]}>
        {offering ? (
          <>
            <input type="hidden" name="kind" value={kind} />
            <Input id={f("kind")} value={{ package: "Session package", subscription: "Membership", one_time: "One-off product" }[kind]} disabled />
          </>
        ) : (
          <Select id={f("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="package">Session package</option>
            <option value="subscription">Membership (recurring)</option>
            <option value="one_time">One-off product</option>
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={f("name")} className="sm:col-span-2">
          <Input id={f("name")} name="name" defaultValue={offering?.name ?? ""} maxLength={120} required placeholder={kind === "subscription" ? "Monthly coaching" : kind === "package" ? "10-session pack" : "12-week strength program"} />
        </Field>
        <Field label="Description" htmlFor={f("description")} className="sm:col-span-2">
          <Textarea id={f("description")} name="description" defaultValue={offering?.description ?? ""} rows={3} />
        </Field>
        <Field label="Features" htmlFor={f("features")} hint="One per line. Shown as a checklist on the pricing page." className="sm:col-span-2">
          <Textarea id={f("features")} name="features" defaultValue={(offering?.features ?? []).join("\n")} rows={4} />
        </Field>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Price</legend>
        <Field label={kind === "subscription" ? "Price per billing period" : "Price"} htmlFor={f("price")}>
          <Input id={f("price")} name="price" type="number" inputMode="decimal" min="0.5" step="0.01" defaultValue={offering ? (offering.price_cents / 100).toFixed(2) : ""} required />
        </Field>
        <Field label="Currency" htmlFor={f("currency")}>
          <Input id={f("currency")} name="currency" defaultValue={offering?.currency ?? "usd"} maxLength={3} pattern="[A-Za-z]{3}" required />
        </Field>
        {kind === "subscription" ? (
          <>
            <Field label="Billed every" htmlFor={f("interval_count")}>
              <div className="flex gap-2">
                <Input id={f("interval_count")} name="interval_count" type="number" min={1} max={12} defaultValue={offering?.interval_count ?? 1} className="w-20" aria-label="Interval count" />
                <Select name="billing_interval" defaultValue={offering?.billing_interval ?? "month"} aria-label="Billing interval">
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </Select>
              </div>
            </Field>
            <Field label="Free trial (days)" htmlFor={f("trial_days")} hint="0 for no trial.">
              <Input id={f("trial_days")} name="trial_days" type="number" min={0} max={730} defaultValue={offering?.trial_days ?? 0} />
            </Field>
          </>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Session credits</legend>
        <Field
          label={kind === "subscription" ? "Credits each billing period" : "Credits included"}
          htmlFor={f("credits")}
          hint={kind === "one_time" ? "Usually 0 for downloads." : "Each credit books one session (or more, per session type)."}
        >
          <Input id={f("credits")} name="credits" type="number" min={kind === "package" ? 1 : 0} max={1000} value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
        </Field>
        {credits > 0 ? (
          <Field label="Credits expire after (days)" htmlFor={f("credits_expire_days")} hint={kind === "subscription" ? "Leave blank to expire at the end of each period." : "Leave blank for no expiry."}>
            <Input id={f("credits_expire_days")} name="credits_expire_days" type="number" min={1} max={3650} defaultValue={offering?.credits_expire_days ?? ""} />
          </Field>
        ) : null}
        {credits > 0 && sessionTypes.length ? (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Valid for</p>
            <p className="text-xs text-zinc-500">Leave all unchecked to allow any session type.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {sessionTypes.map((st) => (
                <Checkbox key={st.id} name="session_type_ids[]" value={st.id} defaultChecked={selected.has(st.id)} label={st.name} />
              ))}
            </div>
          </div>
        ) : null}
      </fieldset>

      {kind === "one_time" ? (
        <DigitalFileInput trainerId={trainerId} defaultPath={offering?.digital_file_path ?? null} defaultName={offering?.digital_file_name ?? null} />
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Options</legend>
        <Checkbox name="includes_messaging" defaultChecked={offering?.includes_messaging ?? true} label="Includes messaging with you" />
        <Checkbox name="includes_programming" defaultChecked={offering?.includes_programming ?? false} label="Includes a training program" />
        <Checkbox name="featured" defaultChecked={offering?.featured ?? false} label="Feature on the pricing page (highlighted as most popular)" />
        <Checkbox name="active" defaultChecked={offering?.active ?? true} label="Available for purchase" />
      </fieldset>

      <Field label="Sort order" htmlFor={f("sort_order")} hint="Lower numbers show first." className="max-w-40">
        <Input id={f("sort_order")} name="sort_order" type="number" defaultValue={offering?.sort_order ?? 0} />
      </Field>

      <div>
        <SubmitButton pendingLabel="Saving & syncing…">{offering ? "Save changes" : "Create offering"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Uploads a file straight to the private digital-products bucket (trainer folder). */
function DigitalFileInput({ trainerId, defaultPath, defaultName }: { trainerId: string; defaultPath: string | null; defaultName: string | null }) {
  const [path, setPath] = useState(defaultPath ?? "");
  const [name, setName] = useState(defaultName ?? defaultPath?.split("/").pop() ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) return setError("Files must be 500 MB or smaller.");
    setBusy(true);
    setProgress(`Uploading ${file.name}…`);
    const safe = file.name.replace(/[^\w.\-]+/g, "-").slice(-100);
    const objectPath = `${trainerId}/${crypto.randomUUID()}/${safe}`;
    const { error: upErr } = await createClient()
      .storage.from("digital-products")
      .upload(objectPath, file, { contentType: file.type || "application/octet-stream", upsert: false });
    setBusy(false);
    setProgress(null);
    if (upErr) return setError(upErr.message);
    setPath(objectPath);
    setName(file.name);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Downloadable file (optional)
      </label>
      <p className="text-xs text-zinc-500">
        Stored privately. Buyers get an expiring download link by email and in their billing page. Leave empty for a service.
      </p>
      <input type="hidden" name="digital_file_path" value={path} />
      <input type="hidden" name="digital_file_name" value={name} />
      {path ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{name || path.split("/").pop()}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setPath(""); setName(""); }}>
            Remove
          </Button>
        </div>
      ) : null}
      <input
        id={id}
        type="file"
        disabled={busy}
        onChange={(e) => onFile(e.target.files?.[0])}
        className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold dark:file:bg-zinc-800"
      />
      {progress ? <p className="text-xs text-zinc-500" role="status">{progress}</p> : null}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}
