"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export type UploadTarget = { bucket: string; path: string; token: string; publicUrl?: string };

/**
 * Signed upload URL so the browser uploads straight to Storage (no 50MB
 * request through the server). PDFs go to the private `lead-magnets` bucket,
 * covers to `public-media`, both under the trainer's own folder.
 */
export async function createMagnetUpload(
  kind: "pdf" | "cover",
  contentType: string,
  size: number,
): Promise<{ ok: true; target: UploadTarget } | { ok: false; error: string }> {
  const trainer = await requireTrainer();
  const admin = createAdminClient();
  if (kind === "pdf") {
    if (contentType !== "application/pdf") return { ok: false, error: "Upload a PDF file." };
    if (!(size > 0 && size <= MAX_PDF_BYTES)) return { ok: false, error: "PDFs can be up to 50 MB." };
    const path = `${trainer.id}/${randomUUID()}.pdf`;
    const { data, error } = await admin.storage.from("lead-magnets").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "Could not start the upload." };
    return { ok: true, target: { bucket: "lead-magnets", path, token: data.token } };
  }
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return { ok: false, error: "Use a JPG, PNG, WebP or GIF image." };
  if (!(size > 0 && size <= MAX_IMAGE_BYTES)) return { ok: false, error: "Images can be up to 20 MB." };
  const path = `${trainer.id}/lead-magnets/${randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("public-media").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Could not start the upload." };
  const publicUrl = admin.storage.from("public-media").getPublicUrl(path).data.publicUrl;
  return { ok: true, target: { bucket: "public-media", path, token: data.token, publicUrl } };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const magnetSchema = z.object({
  title: zfd.requiredText("Add a title").pipe(z.string().max(160)),
  slug: zfd.text().pipe(z.string().max(61).optional()),
  subtitle: zfd.text().pipe(z.string().max(300).optional()),
  description: zfd.text().pipe(z.string().max(5000).optional()),
  bullet_points: zfd.text().pipe(z.string().max(5000).optional()),
  cta_label: zfd.text().pipe(z.string().max(60).optional()),
  thank_you_message: zfd.text().pipe(z.string().max(2000).optional()),
  file_path: zfd.text(),
  cover_image_url: zfd.text().pipe(z.url({ protocol: /^https?$/ }).max(1000).optional()),
  ask_phone: zfd.checkbox(),
  ask_goal: zfd.checkbox(),
  active: zfd.checkbox(),
});

/** Create (id = null) or update a lead magnet. */
export async function saveMagnet(id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  const parsed = parseForm(magnetSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const slug = slugify(d.slug || d.title);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return fail("Use at least 2 letters or numbers in the link.");
  if (d.file_path && !new RegExp(`^${trainer.id}/[0-9a-f-]{36}\\.pdf$`).test(d.file_path)) return fail("Invalid PDF upload.");

  const supabase = await createClient();
  let previousFile: string | null = null;
  if (id) {
    const { data: existing } = await supabase.from("lead_magnets").select("file_path").eq("id", id).eq("trainer_id", trainer.id).maybeSingle();
    if (!existing) return fail("Lead magnet not found.");
    previousFile = existing.file_path;
  }

  const row = {
    trainer_id: trainer.id,
    title: d.title,
    slug,
    subtitle: d.subtitle ?? null,
    description: d.description ?? null,
    bullet_points: (d.bullet_points ?? "")
      .split("\n")
      .map((b) => b.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 12),
    cta_label: d.cta_label ?? "Send me the free guide",
    thank_you_message: d.thank_you_message ?? null,
    file_path: d.file_path ?? previousFile ?? null,
    cover_image_url: d.cover_image_url ?? null,
    ask_phone: d.ask_phone,
    ask_goal: d.ask_goal,
    active: d.active,
  };

  const { data, error } = id
    ? await supabase.from("lead_magnets").update(row).eq("id", id).eq("trainer_id", trainer.id).select("id").single()
    : await supabase.from("lead_magnets").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return fail("That link is already taken. Choose a different one.");
    return fail(error.message);
  }
  if (previousFile && row.file_path !== previousFile) {
    await createAdminClient().storage.from("lead-magnets").remove([previousFile]);
  }
  revalidatePath("/coach/lead-magnets");
  revalidatePath(`/free/${slug}`);
  revalidatePath("/free");
  revalidatePath("/");
  if (!id) redirect(`/coach/lead-magnets/${data.id}?created=1`);
  return ok("Saved.");
}

export async function toggleMagnetActive(formData: FormData): Promise<void> {
  const trainer = await requireTrainer();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase
    .from("lead_magnets")
    .update({ active: formData.get("active") === "true" })
    .eq("id", id.data)
    .eq("trainer_id", trainer.id);
  revalidatePath("/coach/lead-magnets");
  revalidatePath("/free");
  revalidatePath("/");
}

export async function deleteMagnet(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  if (formData.get("confirm") !== "on") return fail("Tick the box to confirm.");
  const supabase = await createClient();
  const { data: magnet } = await supabase.from("lead_magnets").select("id, file_path").eq("id", id).eq("trainer_id", trainer.id).maybeSingle();
  if (!magnet) return fail("Lead magnet not found.");
  const { error } = await supabase.from("lead_magnets").delete().eq("id", magnet.id);
  if (error) return fail(error.message);
  if (magnet.file_path) await createAdminClient().storage.from("lead-magnets").remove([magnet.file_path]);
  revalidatePath("/coach/lead-magnets");
  revalidatePath("/free");
  redirect("/coach/lead-magnets");
}
