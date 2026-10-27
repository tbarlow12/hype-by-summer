"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { parseTags } from "@/lib/clients/metrics";

const uuid = z.uuid();

const detailsSchema = z.object({
  status: z.enum(["active", "paused", "archived"]),
  tags: zfd.text(),
  goals: zfd.text().pipe(z.string().max(4000).optional()),
});

export async function updateClientDetails(clientId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  if (!uuid.safeParse(clientId).success) return fail("Unknown client");
  const parsed = parseForm(detailsSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trainer_clients")
    .update({ status: parsed.data.status, tags: parseTags(parsed.data.tags), goals: parsed.data.goals ?? null })
    .eq("trainer_id", trainer.id)
    .eq("client_id", clientId)
    .select("client_id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("Client not found");
  revalidatePath(`/coach/clients/${clientId}`);
  revalidatePath("/coach/clients");
  return ok("Saved.");
}

const noteSchema = z.object({
  body: zfd.requiredText("Write a note first").pipe(z.string().max(10000)),
  pinned: zfd.checkbox(),
});

export async function addNote(clientId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const trainer = await requireTrainer();
  if (!uuid.safeParse(clientId).success) return fail("Unknown client");
  const parsed = parseForm(noteSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  // RLS also enforces is_trainer_of(client_id).
  const { error } = await supabase
    .from("client_notes")
    .insert({ trainer_id: trainer.id, client_id: clientId, body: parsed.data.body, pinned: parsed.data.pinned });
  if (error) return fail(error.code === "42501" ? "Client not found" : error.message);
  revalidatePath(`/coach/clients/${clientId}`);
  return ok("Note added.");
}

const noteIdSchema = z.object({ note_id: z.uuid(), client_id: z.uuid() });

export async function toggleNotePin(formData: FormData): Promise<void> {
  const trainer = await requireTrainer();
  const parsed = noteIdSchema.extend({ pinned: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("client_notes")
    .update({ pinned: parsed.data.pinned === "true" })
    .eq("id", parsed.data.note_id)
    .eq("trainer_id", trainer.id);
  revalidatePath(`/coach/clients/${parsed.data.client_id}`);
}

export async function deleteNote(formData: FormData): Promise<void> {
  const trainer = await requireTrainer();
  const parsed = noteIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.from("client_notes").delete().eq("id", parsed.data.note_id).eq("trainer_id", trainer.id);
  revalidatePath(`/coach/clients/${parsed.data.client_id}`);
}
