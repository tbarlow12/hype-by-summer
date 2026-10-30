"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { parseTags } from "@/lib/clients/metrics";

const uuid = z.uuid();

const detailsSchema = z.object({
  status: z.enum(["active", "paused", "archived"]),
  tags: zfd.text(),
  goals: zfd.text().pipe(z.string().max(4000).optional()),
  primary_coach_id: zfd.text().pipe(z.uuid().optional()),
});

export async function updateClientDetails(clientId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await requireStaff();
  if (!uuid.safeParse(clientId).success) return fail("Unknown client");
  const parsed = parseForm(detailsSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  // RLS: staff of this business; a trigger checks the coach is an active member.
  const { data, error } = await supabase
    .from("business_clients")
    .update({
      status: parsed.data.status,
      tags: parseTags(parsed.data.tags),
      goals: parsed.data.goals ?? null,
      primary_coach_id: parsed.data.primary_coach_id ?? null,
    })
    .eq("business_id", business.id)
    .eq("client_id", clientId)
    .select("client_id");
  if (error) return fail(error.message.includes("primary_coach_not_member") ? "Pick a coach from your team." : error.message);
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
  const { profile, business } = await requireStaff();
  if (!uuid.safeParse(clientId).success) return fail("Unknown client");
  const parsed = parseForm(noteSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  // RLS: author = caller and the person is a client of this business.
  const { error } = await supabase.from("client_notes").insert({
    business_id: business.id,
    client_id: clientId,
    author_id: profile.id,
    body: parsed.data.body,
    pinned: parsed.data.pinned,
  });
  if (error) return fail(error.code === "42501" ? "Client not found" : error.message);
  revalidatePath(`/coach/clients/${clientId}`);
  return ok("Note added.");
}

const noteIdSchema = z.object({ note_id: z.uuid(), client_id: z.uuid() });

/** Authors edit their own notes; managers any note in the business (RLS enforces the same). */
async function noteScope() {
  const { profile, business, membership } = await requireStaff();
  return { profile, business, manager: isManager(membership) };
}

export async function toggleNotePin(formData: FormData): Promise<void> {
  const { profile, business, manager } = await noteScope();
  const parsed = noteIdSchema.extend({ pinned: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  let q = supabase
    .from("client_notes")
    .update({ pinned: parsed.data.pinned === "true" })
    .eq("id", parsed.data.note_id)
    .eq("business_id", business.id);
  if (!manager) q = q.eq("author_id", profile.id);
  await q;
  revalidatePath(`/coach/clients/${parsed.data.client_id}`);
}

export async function deleteNote(formData: FormData): Promise<void> {
  const { profile, business, manager } = await noteScope();
  const parsed = noteIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  let q = supabase.from("client_notes").delete().eq("id", parsed.data.note_id).eq("business_id", business.id);
  if (!manager) q = q.eq("author_id", profile.id);
  await q;
  revalidatePath(`/coach/clients/${parsed.data.client_id}`);
}
