"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Checkbox, Field, Input, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";
import { createMagnetUpload } from "./actions";

type Magnet = Tables<"lead_magnets">;
type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

function useUpload(kind: "pdf" | "cover") {
  const [status, setStatus] = useState<{ busy: boolean; error?: string; name?: string }>({ busy: false });
  async function upload(file: File): Promise<{ path: string; publicUrl?: string } | null> {
    setStatus({ busy: true, name: file.name });
    const res = await createMagnetUpload(kind, file.type, file.size);
    if (!res.ok) {
      setStatus({ busy: false, error: res.error });
      return null;
    }
    const { error } = await createClient()
      .storage.from(res.target.bucket)
      .uploadToSignedUrl(res.target.path, res.target.token, file, { contentType: file.type });
    if (error) {
      setStatus({ busy: false, error: `Upload failed: ${error.message}` });
      return null;
    }
    setStatus({ busy: false, name: file.name });
    return { path: res.target.path, publicUrl: res.target.publicUrl };
  }
  return { status, upload };
}

export function MagnetForm({ action, magnet }: { action: Action; magnet?: Magnet }) {
  const [filePath, setFilePath] = useState(magnet?.file_path ?? "");
  const [cover, setCover] = useState(magnet?.cover_image_url ?? "");
  const pdf = useUpload("pdf");
  const image = useUpload("cover");
  const busy = pdf.status.busy || image.status.busy;

  return (
    <ActionForm action={action} className="grid gap-5 lg:grid-cols-2">
      <input type="hidden" name="file_path" value={filePath} />
      <div className="space-y-5">
        <Field label="Title" htmlFor="m-title">
          <Input id="m-title" name="title" required maxLength={160} defaultValue={magnet?.title} placeholder="The 4-Week Starter Plan" />
        </Field>
        <Field label="Link" htmlFor="m-slug" hint="yoursite.com/free/<link>. Leave blank to generate from the title.">
          <Input id="m-slug" name="slug" maxLength={61} defaultValue={magnet?.slug} placeholder="starter-plan" pattern="[a-zA-Z0-9-]*" />
        </Field>
        <Field label="Subtitle" htmlFor="m-subtitle">
          <Input id="m-subtitle" name="subtitle" maxLength={300} defaultValue={magnet?.subtitle ?? ""} placeholder="A free printable plan, no gym required." />
        </Field>
        <Field label="Description" htmlFor="m-description">
          <Textarea id="m-description" name="description" rows={4} maxLength={5000} defaultValue={magnet?.description ?? ""} />
        </Field>
        <Field label="What's inside" htmlFor="m-bullets" hint="One bullet per line (up to 12).">
          <Textarea id="m-bullets" name="bullet_points" rows={5} maxLength={5000} defaultValue={magnet?.bullet_points.join("\n")} placeholder={"12 follow-along workouts\nProtein-first meal framework"} />
        </Field>
      </div>

      <div className="space-y-5">
        <Field label="PDF guide" hint="Stored privately; leads get an expiring download link. Max 50 MB.">
          <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            {filePath ? (
              <p className="mb-2 text-sm">
                <span className="font-medium">{pdf.status.name ?? "PDF uploaded"}</span>{" "}
                <span className="text-zinc-500">✓ ready</span>
              </p>
            ) : (
              <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">No PDF yet. Leads can sign up, but there&apos;s nothing to download.</p>
            )}
            <input
              type="file"
              accept="application/pdf"
              aria-label="Upload PDF"
              className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:file:bg-white dark:file:text-zinc-900"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const res = await pdf.upload(file);
                if (res) setFilePath(res.path);
                e.target.value = "";
              }}
            />
            {pdf.status.busy ? <p className="mt-2 text-sm text-zinc-500">Uploading {pdf.status.name}…</p> : null}
            {pdf.status.error ? <div className="mt-2"><Alert tone="red">{pdf.status.error}</Alert></div> : null}
          </div>
        </Field>

        <Field label="Cover image" hint="Portrait (3:4) works best. Without one, a branded cover is generated.">
          <div className="flex gap-4 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="Cover preview" className="h-28 w-21 shrink-0 rounded-lg object-cover" />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                aria-label="Upload cover image"
                className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:file:bg-white dark:file:text-zinc-900"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const res = await image.upload(file);
                  if (res?.publicUrl) setCover(res.publicUrl);
                  e.target.value = "";
                }}
              />
              <Input name="cover_image_url" type="url" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="…or paste an image URL" aria-label="Cover image URL" />
              {cover ? (
                <button type="button" className="text-xs text-zinc-500 hover:text-red-600" onClick={() => setCover("")}>
                  Remove cover
                </button>
              ) : null}
              {image.status.busy ? <p className="text-sm text-zinc-500">Uploading…</p> : null}
              {image.status.error ? <Alert tone="red">{image.status.error}</Alert> : null}
            </div>
          </div>
        </Field>

        <Field label="Button label" htmlFor="m-cta">
          <Input id="m-cta" name="cta_label" maxLength={60} defaultValue={magnet?.cta_label ?? "Send me the free guide"} />
        </Field>
        <Field label="Thank-you message" htmlFor="m-thanks" hint="Shown after sign-up and included in the delivery email.">
          <Textarea id="m-thanks" name="thank_you_message" rows={3} maxLength={2000} defaultValue={magnet?.thank_you_message ?? ""} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Form questions</legend>
          <Checkbox name="ask_goal" defaultChecked={magnet?.ask_goal ?? true} label="Ask for their main goal" />
          <Checkbox name="ask_phone" defaultChecked={magnet?.ask_phone ?? false} label="Ask for a phone number (optional for them)" />
          <p className="text-xs text-zinc-500">Experience, preferred format and timeline are always offered as optional questions on the landing page.</p>
        </fieldset>
        <Checkbox name="active" defaultChecked={magnet?.active ?? true} label="Active (visible on the site)" />
      </div>

      <div className="lg:col-span-2">
        <SubmitButton size="lg" pendingLabel="Saving…" className={busy ? "pointer-events-none opacity-50" : undefined}>
          {magnet ? "Save changes" : "Create lead magnet"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
